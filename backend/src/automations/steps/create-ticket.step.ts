import { z } from 'zod';
import type { Request, Response } from 'express';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { TicketController } from '@/controllers/ticketController';
import { TicketPriority, TicketStatusV2 } from '@prisma/client';
import { logger } from '@/utils/logger';

const CreateTicketConfigSchema = z.object({
  title: variableRef(z.string().min(1)),
  description: variableRef(z.string()).optional(),
  channelId: variableRef(z.string().min(1)),
  projectId: variableRef(z.string().min(1)),
  boardId: variableRef(z.string().min(1)),
  assignedTo: variableRef(z.string()).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  status: z.nativeEnum(TicketStatusV2).optional(),
  createdById: variableRef(z.string()).optional(),
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

export class CreateTicketStep extends BaseActionStep<typeof CreateTicketConfigSchema, CreateTicketOutput> {
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
    context: AutomationContext,
  ): Promise<CreateTicketOutput> {
    const createdBy =
      (config.createdById as string | undefined) ?? context.automation.createdById;
    const description = (config.description as string | undefined) ?? (config.title as string);

    const reqBody: Record<string, unknown> = {
      title: config.title as string,
      description,
      createdBy,
      updatedBy: createdBy,
      channelId: config.channelId as string,
      projectId: config.projectId as string,
      boardId: config.boardId as string,
    };
    if (config.assignedTo !== undefined) reqBody.assignedTo = config.assignedTo;
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
      `[automations] CREATE_TICKET → ticket ${ticket.id} (xyneId=${ticket.xyneId}) created in channel=${reqBody.channelId}, board=${reqBody.boardId}, project=${reqBody.projectId}, conversation=${ticket.conversationId}`,
    );

    return {
      ticketId: ticket.id,
      xyneId: ticket.xyneId,
      boardId: ticket.boardId,
    };
  }
}

export const createTicketStep = new CreateTicketStep();
