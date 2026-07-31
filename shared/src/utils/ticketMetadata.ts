import type { TicketCardSummary } from './activityMetadataParser';
import { serializeTicketMd } from './activityMetadataParser';

export type TicketMdSource = {
  id: string;
  title: string;
  description: string | null;
  statusV2: TicketCardSummary['statusV2'];
  priority: TicketCardSummary['priority'];
  assignedTo: string | null;
  createdBy: string;
  createdAt: number | Date;
  eta: number | Date | null;
  xyneId: string;
  stageName: string | null;
  ticketType: string | null;
  channelId: string | null;
  conversationId: string;
};

const toEpochMs = (value: number | Date | null): number | null => {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.getTime() : value;
};

export const buildTicketCardSummary = (ticket: TicketMdSource): TicketCardSummary => ({
  id: ticket.id,
  title: ticket.title,
  description: ticket.description,
  statusV2: ticket.statusV2,
  priority: ticket.priority,
  assignedTo: ticket.assignedTo ?? null,
  createdBy: ticket.createdBy,
  createdAt: toEpochMs(ticket.createdAt) ?? 0,
  eta: toEpochMs(ticket.eta),
  xyneId: ticket.xyneId,
  stageName: ticket.stageName,
  ticketType: ticket.ticketType ?? null,
  channelId: ticket.channelId ?? '',
  conversationId: ticket.conversationId,
});

export const serializeTicketMdFromTicket = (ticket: TicketMdSource): string | null =>
  serializeTicketMd(buildTicketCardSummary(ticket));

type ZqlLike = any;

type ZeroTicketLike = TicketMdSource;

type ZeroConversationLike = {
  conversationId: string;
  ticket_md: string | null;
};

export async function updateTicketMdFromZero(
  tx: any,
  zql: ZqlLike,
  ticketId: string,
): Promise<void> {
  const ticket = (await tx.run(zql.tickets.where('id', ticketId).one())) as ZeroTicketLike | null;
  if (!ticket?.conversationId) {
    return;
  }

  const ticketMd = serializeTicketMdFromTicket(ticket);
  if (!ticketMd) {
    return;
  }

  const conversation = (await tx.run(
    zql.conversations.where('conversationId', ticket.conversationId).one(),
  )) as ZeroConversationLike | null;
  if (!conversation) {
    return;
  }

  if (conversation.ticket_md === ticketMd) {
    return;
  }

  await tx.mutate.conversations.update({
    conversationId: ticket.conversationId,
    ticket_md: ticketMd,
  });
}
