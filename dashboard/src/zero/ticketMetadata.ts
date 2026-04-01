import type { Transaction } from '@rocicorp/zero';
import { Schema, serializeTicketMd } from '@xyne/shared';
import type { TicketCardSummary } from '@xyne/shared';
import { zql } from './queries';

export async function updateTicketMd(tx: Transaction<Schema>, ticketId: string): Promise<void> {
  const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
  if (!ticket?.conversationId) {
    return;
  }

  const summary: TicketCardSummary = {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    statusV2: ticket.statusV2,
    priority: ticket.priority,
    assignedTo: ticket.assignedTo ?? null,
    createdBy: ticket.createdBy,
    createdAt: ticket.createdAt,
    eta: ticket.eta ?? null,
    xyneId: ticket.xyneId,
    stageName: ticket.stageName,
    ticketType: ticket.ticketType ?? null,
    channelId: ticket.channelId,
    conversationId: ticket.conversationId,
  };

  const ticketMd = serializeTicketMd(summary);

  const conversation = await tx.run(
    zql.conversations.where('conversationId', ticket.conversationId).one(),
  );
  if (!conversation) {
    return;
  }

  if (conversation.ticket_md === ticketMd) {
    return;
  }

  await tx.mutate.conversations.update({
    conversationId: ticket.conversationId,
    // Zero mutation payloads follow the DB column naming.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ticket_md: ticketMd,
  });
}
