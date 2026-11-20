import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { BaseActionStep, variableRef, withOptions } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import type { Request, Response } from 'express';
import { TicketPriority } from '@xyne/shared';
import { z } from 'zod';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { TicketController } from '@/controllers/ticketController';
import { createChildTicketTx } from '@/bypassAcl/transactions/createTicketStep';
import type { XyneCtx } from '@/workflowsV2/types';
import { boardOptions, channelOptions, noOptions, optionsQuery, stageOptions, userOptions } from '../options';
import { actorOf, workspaceOf } from '../context';

const CreateTicketConfigSchema = z.object({
  boardId: withOptions(variableRef(z.string().min(1))).describe('Board the ticket goes on'),
  title: variableRef(z.string().min(1)),
  description: variableRef(z.string()).optional(),
  parentTicket: variableRef(z.string())
    .optional()
    .describe("Ticket id or ID like PLAT-12. Given, the ticket is created as its sub-ticket, in the parent's conversation"),
  channelId: withOptions(variableRef(z.string()))
    .optional()
    .describe('Channel the ticket is posted in. Required without a parent ticket'),
  stageName: withOptions(variableRef(z.string())).optional().describe("Defaults to the board's first stage"),
  assignedTo: withOptions(variableRef(z.string())).optional(),
  priority: variableRef(z.nativeEnum(TicketPriority)).optional(),
});
type CreateTicketConfig = z.infer<typeof CreateTicketConfigSchema>;

const CreateTicketOutputSchema = z.object({
  ticketId: z.string(),
  xyneId: z.string(),
  boardId: z.string(),
  subTicketId: z.string().nullable().describe('The sub-ticket row under the parent; null without a parent'),
  parentTicketId: z.string().nullable(),
});
type CreateTicketOutput = z.infer<typeof CreateTicketOutputSchema>;

const ticketController = new TicketController();

export class CreateTicketStep extends BaseActionStep<typeof CreateTicketConfigSchema, CreateTicketOutput> {
  readonly type = 'CREATE_TICKET';
  readonly configSchema = CreateTicketConfigSchema;
  readonly outputSchema = CreateTicketOutputSchema;
  readonly name = 'Create a ticket';
  readonly description = 'Creates a ticket on a board, or a sub-ticket under a parent ticket.';
  readonly category = 'ticket';
  readonly icon = 'TicketPlus';

  override getOptions(
    ctx: FieldOptionsContext<CreateTicketConfig, Record<string, unknown>, XyneCtx>,
  ): Promise<FieldOptionsPage> {
    const query = optionsQuery(ctx);
    switch (ctx.field) {
      case 'boardId':
        return boardOptions(query);
      case 'channelId':
        return channelOptions(query);
      case 'stageName': {
        const boardId = ctx.literal.boardId;
        return stageOptions(query, typeof boardId === 'string' && boardId ? [boardId] : undefined);
      }
      case 'assignedTo':
        return userOptions(query);
      default:
        return Promise.resolve(noOptions);
    }
  }

  async execute(config: CreateTicketConfig, ctx: StepExecutionContext): Promise<CreateTicketOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const createdBy = await actorOf(ctx, this.type);
    const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
    const boardId = text(config.boardId);
    const title = text(config.title);
    const description = text(config.description);
    const stageName = text(config.stageName) || undefined;
    const assignedTo = text(config.assignedTo) || undefined;
    const priority = text(config.priority) || undefined;

    const board = await db.board.findFirst({ where: { id: boardId, workspaceId }, select: { id: true, projectId: true } });
    if (!board) throw new Error(`Board ${boardId} not found`);

    const parentRef = text(config.parentTicket);
    if (parentRef) {
      const parent = await repositories.tickets.getTicketByXyneIdOrId(parentRef, workspaceId);
      if (!parent) throw new Error(`Parent ticket ${parentRef} not found`);
      const created = await createChildTicketTx({
        parent: {
          id: parent.id,
          workspaceId: parent.workspaceId,
          conversationId: parent.conversationId,
          channelId: parent.channelId,
        },
        projectId: board.projectId,
        boardId: board.id,
        title,
        description,
        stageName,
        priority,
        assignedTo,
        createdBy,
      });
      return { ...created, boardId: board.id, parentTicketId: parent.id };
    }

    const channelId = text(config.channelId);
    if (!channelId) throw new Error('Give a channelId, or a parentTicket to create a sub-ticket');

    const body: Record<string, unknown> = {
      title,
      description: description || title,
      createdBy,
      updatedBy: createdBy,
      channelId,
      projectId: board.projectId,
      boardId: board.id,
      ...(stageName ? { stageName } : {}),
      ...(assignedTo ? { assignedTo } : {}),
      ...(priority ? { priority } : {}),
    };
    let status = 200;
    let response: unknown;
    const req = { body, headers: {}, user: { id: createdBy, workspaceId }, files: {} } as unknown as Request;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        response = payload;
        return this;
      },
    } as unknown as Response;
    await ticketController.createTicket(req, res);
    if (status >= 400 || !response) {
      const message = (response as { error?: string } | undefined)?.error ?? `status ${status}`;
      throw new Error(`Ticket creation failed: ${message}`);
    }
    const ticket = response as { id: string; xyneId: string };
    return { ticketId: ticket.id, xyneId: ticket.xyneId, boardId: board.id, subTicketId: null, parentTicketId: null };
  }
}
