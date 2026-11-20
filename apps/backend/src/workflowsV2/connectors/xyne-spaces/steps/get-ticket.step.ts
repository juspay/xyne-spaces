import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { z } from 'zod';
import { db } from '@/database/client';
import { workspaceOf } from '../context';

const GetTicketConfigSchema = z.object({
  ticket: variableRef(z.string().min(1)).describe('Ticket id or ID like PLAT-12'),
});
type GetTicketConfig = z.infer<typeof GetTicketConfigSchema>;

const SubTicketSchema = z.object({
  subTicketId: z.string().describe('The sub-ticket row; what release dev tickets and changes attach to'),
  title: z.string(),
  ticketId: z.string().nullable().describe('The ticket the sub-ticket points to; null when it points to none'),
  xyneId: z.string().nullable(),
  boardId: z.string().nullable(),
  stageName: z.string().nullable(),
  status: z.string().nullable(),
});

const GetTicketOutputSchema = z.object({
  id: z.string(),
  xyneId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  boardId: z.string(),
  projectId: z.string(),
  channelId: z.string(),
  conversationId: z.string(),
  stageName: z.string().nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  ticketType: z.string().nullable(),
  assignedTo: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  subTickets: z.array(SubTicketSchema),
});
type GetTicketOutput = z.infer<typeof GetTicketOutputSchema>;

export class GetTicketStep extends BaseActionStep<typeof GetTicketConfigSchema, GetTicketOutput> {
  readonly type = 'GET_TICKET';
  readonly configSchema = GetTicketConfigSchema;
  readonly outputSchema = GetTicketOutputSchema;
  readonly name = 'Get a ticket';
  readonly description = "Reads a ticket's details and its sub-tickets.";
  readonly category = 'ticket';
  readonly icon = 'Ticket';

  async execute(config: GetTicketConfig, ctx: StepExecutionContext): Promise<GetTicketOutput> {
    const identifier = (config.ticket as string).trim();
    const ticket = await db.ticket.findFirst({
      where: { workspaceId: workspaceOf(ctx, this.type), OR: [{ id: identifier }, { xyneId: identifier }] },
    });
    if (!ticket) throw new Error(`Ticket ${identifier} not found`);

    const mappings = await db.ticketSubTicketMapping.findMany({
      where: { ticketId: ticket.id },
      select: {
        subTicket: {
          select: {
            id: true,
            title: true,
            mappedTicket: { select: { id: true, xyneId: true, boardId: true, stageName: true, statusV2: true } },
          },
        },
      },
    });

    return {
      id: ticket.id,
      xyneId: ticket.xyneId,
      title: ticket.title,
      description: ticket.description,
      boardId: ticket.boardId,
      projectId: ticket.projectId,
      channelId: ticket.channelId,
      conversationId: ticket.conversationId,
      stageName: ticket.stageName,
      status: ticket.statusV2,
      priority: ticket.priority,
      ticketType: ticket.ticketType,
      assignedTo: ticket.assignedTo,
      createdBy: ticket.createdBy,
      createdAt: ticket.createdAt.toISOString(),
      subTickets: mappings.map(({ subTicket }) => ({
        subTicketId: subTicket.id,
        title: subTicket.title,
        ticketId: subTicket.mappedTicket?.id ?? null,
        xyneId: subTicket.mappedTicket?.xyneId ?? null,
        boardId: subTicket.mappedTicket?.boardId ?? null,
        stageName: subTicket.mappedTicket?.stageName ?? null,
        status: subTicket.mappedTicket?.statusV2 ?? null,
      })),
    };
  }
}
