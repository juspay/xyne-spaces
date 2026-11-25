import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { BaseActionStep, variableRef, withOptions } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { TicketPriority } from '@xyne/shared';
import { z } from 'zod/v3';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { generateTicketId } from '@/bypassAcl/transactions/ticketIdService';
import { createSubTicket } from '@/services/subTicketService';
import type { XyneCtx } from '@/workflowsV2/types';
import { boardOptions, noOptions, optionsQuery } from '../options';
import { actorOf, workspaceOf } from '../context';
import { boardIssues, ticketIssues } from '../validation';
import type { Checked, ConfigIssue } from '../validation';

const CreateTicketConfigSchema = z.object({
  boardId: withOptions(variableRef(z.string().min(1))).describe('Board the ticket goes on'),
  title: variableRef(z.string().min(1)),
  description: variableRef(z.string()).optional(),
  parentTicket: variableRef(z.string().min(1)).describe(
    "Ticket id or ID like PLAT-12. The ticket is created as its sub-ticket, in the parent's conversation",
  ),
  priority: variableRef(z.nativeEnum(TicketPriority)).optional(),
});
type CreateTicketConfig = z.infer<typeof CreateTicketConfigSchema>;

const CreateTicketOutputSchema = z.object({
  ticketId: z.string(),
  xyneId: z.string(),
  boardId: z.string(),
  subTicketId: z.string().describe('The sub-ticket row under the parent'),
  parentTicketId: z.string(),
});
type CreateTicketOutput = z.infer<typeof CreateTicketOutputSchema>;

export class CreateTicketStep extends BaseActionStep<typeof CreateTicketConfigSchema, CreateTicketOutput> {
  readonly type = 'CREATE_TICKET';
  readonly configSchema = CreateTicketConfigSchema;
  readonly outputSchema = CreateTicketOutputSchema;
  readonly name = 'Create a sub-ticket';
  readonly description = 'Creates a sub-ticket on a board under a parent ticket.';
  readonly category = 'ticket';
  readonly icon = 'TicketPlus';

  override getOptions(
    ctx: FieldOptionsContext<CreateTicketConfig, Record<string, unknown>, XyneCtx>,
  ): Promise<FieldOptionsPage> {
    return ctx.field === 'boardId' ? boardOptions(optionsQuery(ctx)) : Promise.resolve(noOptions);
  }

  async validateConfig(ctx: Checked<{ boardId?: string; parentTicket?: string }>): Promise<ConfigIssue[]> {
    return (
      await Promise.all([
        boardIssues(ctx, 'boardId', ctx.known.boardId),
        ticketIssues(ctx, 'parentTicket', ctx.known.parentTicket),
      ])
    ).flat();
  }

  async execute(config: CreateTicketConfig, ctx: StepExecutionContext): Promise<CreateTicketOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const createdBy = await actorOf(ctx, this.type);
    const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
    const boardId = text(config.boardId);

    const board = await db.board.findFirst({ where: { id: boardId, workspaceId }, select: { id: true, projectId: true } });
    if (!board) throw new Error(`Board ${boardId} not found`);

    const parentRef = text(config.parentTicket);
    const parent = await repositories.tickets.getTicketByXyneIdOrId(parentRef, workspaceId);
    if (!parent) throw new Error(`Parent ticket ${parentRef} not found`);
    const title = text(config.title);
    const description = text(config.description);
    // The ticket lives in the parent's conversation, as the sub-ticket of a release does.
    const xyneId = await generateTicketId(db, board.projectId);
    const ticket = await repositories.tickets.createTicket({
      title,
      description,
      createdBy,
      updatedBy: createdBy,
      conversationId: parent.conversationId,
      channelId: parent.channelId,
      projectId: board.projectId,
      workspaceId: parent.workspaceId,
      boardId: board.id,
      xyneId,
      ...(text(config.priority) ? { priority: text(config.priority) as TicketPriority } : {}),
    });
    const sub = await createSubTicket({
      parentTicketId: parent.id,
      title,
      description,
      createdBy,
      mappedTicketId: ticket.id,
      subTicketXyneId: xyneId,
    });
    return { ticketId: ticket.id, xyneId, boardId: board.id, subTicketId: sub.subTicketId, parentTicketId: parent.id };
  }
}
