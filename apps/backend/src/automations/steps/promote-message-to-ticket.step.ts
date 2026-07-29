import { z } from 'zod';
import type { Request, Response } from 'express';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { TicketController } from '@/controllers/ticketController';
import { TicketPriority, TicketStatusV2 } from '@prisma/client';
import { logger } from '@/utils/logger';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';

const PromoteMessageToTicketConfigSchema = z.object({
  conversationId: variableRef(z.string().min(1)),
  title: variableRef(z.string().min(1)),
  description: variableRef(z.string()).optional(),
  projectId: variableRef(z.string().min(1)),
  boardId: variableRef(z.string().min(1)),
  assigneeId: variableRef(z.string()).optional(),
  userGroupId: variableRef(z.string()).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  status: z.nativeEnum(TicketStatusV2).optional(),
  createdById: variableRef(z.string()).optional(),
});

const PromoteMessageToTicketOutputSchema = z.object({
  ticketId: z.string(),
  xyneId: z.string(),
  boardId: z.string(),
});

interface PromoteMessageToTicketOutput extends Record<string, unknown> {
  ticketId: string;
  xyneId: string;
  boardId: string;
}

const ticketController = new TicketController();

export class PromoteMessageToTicketStep extends BaseActionStep<
  typeof PromoteMessageToTicketConfigSchema,
  PromoteMessageToTicketOutput
> {
  readonly type = 'PROMOTE_MESSAGE_TO_TICKET';
  readonly configSchema = PromoteMessageToTicketConfigSchema;
  readonly outputSchema = PromoteMessageToTicketOutputSchema;
  readonly name = 'Promote a message to a ticket';
  readonly description =
    'Creates a ticket from an existing conversation (the message and its thread). The channel is taken from the conversation.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'TicketPlus';
  readonly mayEmit = ['TICKET_CREATED'] as const;

  async execute(
    config: z.infer<typeof PromoteMessageToTicketConfigSchema>,
    context: AutomationContext,
  ): Promise<PromoteMessageToTicketOutput> {
    const createdBy =
      (config.createdById as string | undefined) ?? context.automation.createdById;
    const rawTitle = config.title as string;
    const title = extractPlainTextFromHtml(rawTitle).trim() || rawTitle;
    const description = (config.description as string | undefined) ?? title;

    // The channel is derived from the source conversation by the controller.
    const reqBody: Record<string, unknown> = {
      title,
      description,
      createdBy,
      updatedBy: createdBy,
      sourceConversationId: config.conversationId as string,
      projectId: config.projectId as string,
      boardId: config.boardId as string,
    };
    if (config.assigneeId !== undefined) reqBody.assignedTo = config.assigneeId;
    if (config.userGroupId !== undefined) reqBody.userGroupId = config.userGroupId;
    if (config.priority !== undefined) reqBody.priority = config.priority;
    if (config.status !== undefined) reqBody.statusV2 = config.status;

    const fakeReq = {
      body: reqBody,
      headers: {},
      user: { id: createdBy },
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
        `Promote to ticket failed (status=${capturedStatus})`;
      throw new Error(`[PROMOTE_MESSAGE_TO_TICKET] ${message}`);
    }

    const ticket = capturedBody as {
      id: string;
      xyneId: string;
      boardId: string;
      conversationId: string;
    };

    logger.info(
      `[automations] PROMOTE_MESSAGE_TO_TICKET → ticket ${ticket.id} (xyneId=${ticket.xyneId}) from conversation=${reqBody.sourceConversationId}, board=${reqBody.boardId}, project=${reqBody.projectId}`,
    );

    return {
      ticketId: ticket.id,
      xyneId: ticket.xyneId,
      boardId: ticket.boardId,
    };
  }
}

export const promoteMessageToTicketStep = new PromoteMessageToTicketStep();
