import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import z from 'zod';
import { summaryTemplateService, SummaryTemplateError } from '@/services/summaryTemplateService';
import { DefaultOutlet } from '@xyne/shared';
import { logger } from '@/utils/logger';

const JsonObjectOrArraySchema = z.union([z.record(z.unknown()), z.array(z.unknown())]);

const SummaryTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  autoTriggerPrompt: z.string().trim().max(500).nullable().optional(),
  sections: JsonObjectOrArraySchema,
  version: z.number().int().positive().default(1),
  systemPrompt: z.string().trim().min(1).max(20_000),
  defaultOutlet: z.enum([DefaultOutlet.EMAIL, DefaultOutlet.MESSAGE]).default(DefaultOutlet.EMAIL),
});

const SummaryTemplateUpdateSchema = SummaryTemplateCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field is required' }
);

function sendError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ success: false, error: error.errors[0]?.message });
    return;
  }
  if (error instanceof SummaryTemplateError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  logger.error('Summary template request failed', error);
  res.status(500).json({ success: false, error: 'Summary template request failed' });
}

export class SummaryTemplateController {
  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const templates = await summaryTemplateService.list(req.user!.workspaceId);
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
}

export const summaryTemplateController = new SummaryTemplateController();
