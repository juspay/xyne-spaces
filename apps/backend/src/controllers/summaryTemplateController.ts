import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import z from 'zod';
import { summaryTemplateService, SummaryTemplateError } from '@/services/summaryTemplateService';
import { summaryTemplateAiService } from '@/services/summaryTemplateAiService';
import { DefaultOutlet } from '@xyne/shared';
import { logger } from '@/utils/logger';
import {
  summaryTemplateSharingService,
  SummaryTemplateSharingError,
  type SummaryTemplateSharingCommand,
} from '@/services/summaryTemplateSharingService';
import {
  summaryTemplatePublicationService,
  SummaryTemplatePublicationError,
} from '@/services/summaryTemplatePublicationService';

const SummaryTemplateSectionSchema = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
});

const SummaryTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  autoTriggerPrompt: z.string().trim().max(500).nullable().optional(),
  sections: z.array(SummaryTemplateSectionSchema).min(1).max(20),
  systemPrompt: z.string().trim().max(12_000).optional(),
  version: z.number().int().positive().default(1),
  defaultOutlet: z.enum([DefaultOutlet.EMAIL, DefaultOutlet.MESSAGE]).default(DefaultOutlet.EMAIL),
});

const SummaryTemplateUpdateSchema = SummaryTemplateCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field is required' }
);

const SummaryTemplatePublicationActionSchema = z.object({
  action: z.enum(['request', 'publish', 'withdraw', 'approve', 'deny', 'unpublish']),
});

const SummaryTemplateShareTargetSchema = z.object({
  type: z.enum(['user', 'user_group', 'channel']),
  id: z.string().min(1),
});

const SummaryTemplateSharingCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('grant'),
    targets: z.array(SummaryTemplateShareTargetSchema).min(1).max(100),
  }),
  z.object({
    action: z.literal('revoke'),
    targets: z.array(SummaryTemplateShareTargetSchema).min(1).max(100),
  }),
]);

const SummaryTemplateAiInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  meetingContext: z.string().trim().max(500).nullable().optional(),
  sections: z
    .array(
      z.object({
        title: z.string().trim().max(100),
        description: z.string().trim().max(500),
      })
    )
    .max(20)
    .optional(),
});

function sendError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ success: false, error: error.errors[0]?.message });
    return;
  }
  if (error instanceof SummaryTemplateError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  if (error instanceof SummaryTemplateSharingError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  if (error instanceof SummaryTemplatePublicationError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  logger.error('Summary template request failed', error);
  res.status(500).json({ success: false, error: 'Summary template request failed' });
}

export class SummaryTemplateController {
  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const templates = await summaryTemplateService.list(req.user!.workspaceId, req.user!.id);
      res.json({ success: true, templates });
    } catch (error) {
      sendError(res, error);
    }
  };

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const input = SummaryTemplateCreateSchema.parse(req.body);
      const template = await summaryTemplateService.create(req.user!.workspaceId, req.user!.id, {
        ...input,
        sections: input.sections as Prisma.InputJsonValue,
      });
      res.status(201).json({ success: true, template });
    } catch (error) {
      sendError(res, error);
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const input = SummaryTemplateUpdateSchema.parse(req.body);
      const { sections, ...rest } = input;
      const template = await summaryTemplateService.update(
        req.params.templateId,
        req.user!.workspaceId,
        req.user!.id,
        {
          ...rest,
          ...(sections !== undefined ? { sections: sections as Prisma.InputJsonValue } : {}),
        }
      );
      res.json({ success: true, template });
    } catch (error) {
      sendError(res, error);
    }
  };

  publicationContext = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await summaryTemplatePublicationService.getContext({
        userId: req.user!.id,
        workspaceId: req.user!.workspaceId,
      });
      res.json({ success: true, ...context });
    } catch (error) {
      sendError(res, error);
    }
  };

  managePublication = async (req: Request, res: Response): Promise<void> => {
    try {
      const { action } = SummaryTemplatePublicationActionSchema.parse(req.body);
      const template = await summaryTemplatePublicationService.execute(
        req.params.templateId,
        { userId: req.user!.id, workspaceId: req.user!.workspaceId },
        action
      );
      res.json({ success: true, template });
    } catch (error) {
      sendError(res, error);
    }
  };

  listShares = async (req: Request, res: Response): Promise<void> => {
    try {
      const shares = await summaryTemplateSharingService.list(req.params.templateId, {
        userId: req.user!.id,
        workspaceId: req.user!.workspaceId,
      });
      res.json({ success: true, shares });
    } catch (error) {
      sendError(res, error);
    }
  };

  manageSharing = async (req: Request, res: Response): Promise<void> => {
    try {
      const command = SummaryTemplateSharingCommandSchema.parse(req.body);
      const result = await summaryTemplateSharingService.execute(
        req.params.templateId,
        { userId: req.user!.id, workspaceId: req.user!.workspaceId },
        command as SummaryTemplateSharingCommand
      );
      res.json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  };

  delete = async (req: Request, res: Response): Promise<void> => {
    try {
      await summaryTemplateService.delete(
        req.params.templateId,
        req.user!.workspaceId,
        req.user!.id
      );
      res.status(204).send();
    } catch (error) {
      sendError(res, error);
    }
  };

  draftContext = async (req: Request, res: Response): Promise<void> => {
    try {
      const input = SummaryTemplateAiInputSchema.parse(req.body);
      const context = await summaryTemplateAiService.draftMeetingContext(
        input,
        `summary-template:${req.user!.workspaceId}:${req.user!.id}`
      );
      if (!context) {
        res.status(502).json({ success: false, error: 'Unable to draft meeting context' });
        return;
      }
      res.json({ success: true, context });
    } catch (error) {
      sendError(res, error);
    }
  };

  suggestSections = async (req: Request, res: Response): Promise<void> => {
    try {
      const input = SummaryTemplateAiInputSchema.parse(req.body);
      const sections = await summaryTemplateAiService.suggestSections(
        input,
        `summary-template:${req.user!.workspaceId}:${req.user!.id}`
      );
      if (!sections) {
        res.status(502).json({ success: false, error: 'Unable to suggest sections' });
        return;
      }
      res.json({ success: true, sections });
    } catch (error) {
      sendError(res, error);
    }
  };

  generateSystemPrompt = async (req: Request, res: Response): Promise<void> => {
    try {
      const input = SummaryTemplateAiInputSchema.parse(req.body);
      const systemPrompt = await summaryTemplateAiService.generateSystemPrompt(
        input,
        `summary-template-system:${req.user!.workspaceId}:${req.user!.id}`
      );
      if (!systemPrompt) {
        res.status(502).json({ success: false, error: 'Unable to generate system prompt' });
        return;
      }
      res.json({ success: true, systemPrompt });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export const summaryTemplateController = new SummaryTemplateController();
