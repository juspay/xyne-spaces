import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { BaseActionStep, variableRef, withOptions } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { TicketPriority } from '@xyne/shared';
import { z } from 'zod';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { createChildTicketTx } from '@/bypassAcl/transactions/createTicketStep';
import type { XyneCtx } from '@/workflowsV2/types';
import { boardOptions, noOptions, optionsQuery } from '../options';
import { actorOf, workspaceOf } from '../context';

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
    const created = await createChildTicketTx({
      parent: {
        id: parent.id,
        workspaceId: parent.workspaceId,
        conversationId: parent.conversationId,
        channelId: parent.channelId,
      },
      projectId: board.projectId,
      boardId: board.id,
      title: text(config.title),
      description: text(config.description),
      priority: text(config.priority) || undefined,
      createdBy,
    });
    return { ...created, boardId: board.id, parentTicketId: parent.id };
  }
}
