import { z } from 'zod';
import { BaseTicketType, TicketPriority, TicketStatusV2 } from '@xyne/shared';
import type { Request, Response } from 'express';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { TicketController } from '@/controllers/ticketController';
import { logger } from '@/utils/logger';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { generateTitle } from '@/services/agents/title-generator';

const MAX_TITLE_LENGTH = 100;
const MAX_TITLE_RETRIES = 3;
const TITLE_RETRY_DELAY_MS = 500;

const CreateTicketConfigSchema = z.object({
  title: variableRef(
    z.string().describe('Leave empty to auto-generate a title from the description.')
  ).optional(),
  description: variableRef(z.string().min(1)),
  channelId: variableRef(z.string().min(1)),
  projectId: variableRef(z.string().min(1)),
  boardId: variableRef(z.string().min(1)),
  assigneeId: variableRef(z.string()).optional(),
  userGroupId: variableRef(z.string()).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  status: z.nativeEnum(TicketStatusV2).optional(),
  createdById: variableRef(z.string()).optional(),
  ticketType: z
    .nativeEnum(BaseTicketType)
    .optional()
    .describe(
      'Ticket type. Pick Release or Hotfix on a release board to start commit analysis; leave empty for the board default.'
    ),
  formFields: z
    .array(
      z.object({
        fieldName: z.string().min(1).describe('Board form field name, e.g. branch, deployedCommitId, newCommitId.'),
        value: variableRef(z.string().nullable().optional()).describe(
          'Value to set. Supports {{...}} placeholders.'
        ),
      })
    )
    .optional()
    .describe(
      'Board form field values set at creation time. Release tickets need branch, deployedCommitId and newCommitId here for commit analysis to run.'
    ),
});

const CreateTicketOutputSchema = z.object({
  ticketId: z.string(),
  xyneId: z.string(),
  boardId: z.string(),
});

interface CreateTicketOutput extends Record<string, unknown> {
  ticketId: string;
  xyneId: string;
  boardId: string;
}

const ticketController = new TicketController();

function truncateForTitle(text: string): string {
  if (text.length <= MAX_TITLE_LENGTH) return text;
  return `${text.slice(0, MAX_TITLE_LENGTH - 3)}...`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Turns the step's `formFields` list into the `dynamicFields` map the ticket
 * controller reads. Blank values are dropped so an unresolved placeholder
 * doesn't overwrite a board default with an empty string; a repeated field
 * name keeps the last value.
 */
export function buildDynamicFields(
  formFields: Array<{ fieldName: string; value?: unknown }> | undefined
): Record<string, string> {
  const dynamicFields: Record<string, string> = {};
  for (const field of formFields ?? []) {
    const name = field.fieldName?.trim();
    if (!name || field.value === undefined || field.value === null) continue;
    const value = String(field.value).trim();
    if (!value) continue;
    dynamicFields[name] = value;
  }
  return dynamicFields;
}

async function generateTitleWithRetry(description: string, userId: string): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_TITLE_RETRIES; attempt++) {
    try {
      const generated = await generateTitle(
        { description, maxLength: MAX_TITLE_LENGTH },
        { userId }
      );
      return generated.title;
    } catch (error) {
      if (attempt === MAX_TITLE_RETRIES) {
        logger.warn('[CREATE_TICKET] Title generation failed, falling back to description', error);
        return null;
      }
      logger.warn(
        `[CREATE_TICKET] Title generation attempt ${attempt}/${MAX_TITLE_RETRIES} failed, retrying...`,
        error
      );
      await delay(TITLE_RETRY_DELAY_MS);
    }
  }

  return null;
}

export class CreateTicketStep extends BaseActionStep<
  typeof CreateTicketConfigSchema,
  CreateTicketOutput
> {
  readonly type = 'CREATE_TICKET';
  readonly configSchema = CreateTicketConfigSchema;
  readonly outputSchema = CreateTicketOutputSchema;
  readonly name = 'Create a ticket';
  readonly description =
    'Creates a ticket on the chosen board. Uses the same flow as the dashboard so the ticket card appears in the channel and the board view.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'TicketPlus';
  readonly mayEmit = ['TICKET_CREATED'] as const;

  async execute(
    config: z.infer<typeof CreateTicketConfigSchema>,
    context: AutomationContext
  ): Promise<CreateTicketOutput> {
    const createdBy = (config.createdById as string | undefined) ?? context.automation.createdById;

    const rawTitle = config.title as string | undefined;
    const rawDescription = config.description as string;
    if (!rawDescription?.trim()) {
      throw new Error('[CREATE_TICKET] Description must be provided');
    }

    const description = rawDescription;
    const plainDescription = extractPlainTextFromHtml(description).trim();

    let title = rawTitle?.trim() ? extractPlainTextFromHtml(rawTitle).trim() : '';

    if (!title) {
      if (!plainDescription) {
        throw new Error('[CREATE_TICKET] Description must contain text to generate a title');
      }
      title =
        (await generateTitleWithRetry(plainDescription, createdBy)) ??
        truncateForTitle(plainDescription);
    }

    const reqBody: Record<string, unknown> = {
      title,
      description,
      createdBy,
      updatedBy: createdBy,
      channelId: config.channelId as string,
      projectId: config.projectId as string,
      boardId: config.boardId as string,
    };
    if (config.assigneeId !== undefined) reqBody.assignedTo = config.assigneeId;
    if (config.userGroupId !== undefined) reqBody.userGroupId = config.userGroupId;
    if (config.priority !== undefined) reqBody.priority = config.priority;
    if (config.status !== undefined) reqBody.statusV2 = config.status;
    if (config.ticketType !== undefined) reqBody.ticketType = config.ticketType;
    const dynamicFields = buildDynamicFields(
      config.formFields as Array<{ fieldName: string; value?: unknown }> | undefined
    );
    if (Object.keys(dynamicFields).length > 0) reqBody.dynamicFields = dynamicFields;

    const fakeReq = {
      body: reqBody,
      headers: {},
      user: { id: createdBy, workspaceId: context.automation.workspaceId },
      files: {},
    } as unknown as Request;

    let capturedStatus = 200;
    let capturedBody: unknown = undefined;
    const fakeRes = {
      status(code: number) {
        capturedStatus = code;
        return this;
      },
      json(body: unknown) {
        capturedBody = body;
        return this;
      },
    } as unknown as Response;

    await ticketController.createTicket(fakeReq, fakeRes);

    if (capturedStatus >= 400 || !capturedBody) {
      const message =
        (capturedBody as { error?: string } | undefined)?.error ??
        `Ticket creation failed (status=${capturedStatus})`;
      throw new Error(`[CREATE_TICKET] ${message}`);
    }

    const ticket = capturedBody as {
      id: string;
      xyneId: string;
      boardId: string;
      conversationId: string;
    };

    logger.info(
      `[automations] CREATE_TICKET → ticket ${ticket.id} (xyneId=${ticket.xyneId}) created in channel=${reqBody.channelId}, board=${reqBody.boardId}, type=${reqBody.ticketType ?? 'default'}, formFields=[${Object.keys(dynamicFields).join(',')}], project=${reqBody.projectId}, conversation=${ticket.conversationId}`
    );

    return {
      ticketId: ticket.id,
      xyneId: ticket.xyneId,
      boardId: ticket.boardId,
    };
  }
}

export const createTicketStep = new CreateTicketStep();
