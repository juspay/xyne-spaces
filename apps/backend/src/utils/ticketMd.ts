import type { PrismaClient, Ticket as PrismaTicket } from '@prisma/client';
import { serializeTicketMd } from '@xyne/shared';
import type { TicketCardSummary } from '@xyne/shared';

type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export const syncConversationTicketMdFromPrismaTicket = async (
  tx: PrismaTransaction,
  ticket: PrismaTicket,
  overrides: Partial<TicketCardSummary> = {},
): Promise<void> => {
  if (!ticket.conversationId) return;

  const summary: TicketCardSummary = {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    statusV2: ticket.statusV2 as TicketCardSummary['statusV2'],
    priority: ticket.priority as TicketCardSummary['priority'],
    assignedTo: ticket.assignedTo ?? null,
    createdBy: ticket.createdBy,
    createdAt: ticket.createdAt.getTime(),
    eta: ticket.eta ? ticket.eta.getTime() : null,
    xyneId: ticket.xyneId,
    stageName: ticket.stageName,
    ticketType: ticket.ticketType ?? null,
    channelId: ticket.channelId,
    conversationId: ticket.conversationId,
    ...overrides,
  };

  const ticketMd = serializeTicketMd(summary);
  if (!ticketMd) return;

  const conversation = await tx.conversation.findUnique({
    where: { conversationId: ticket.conversationId },
    select: { ticket_md: true },
  });

  if (!conversation) return;
  if (conversation.ticket_md === ticketMd) return;

  await tx.conversation.update({
    where: { conversationId: ticket.conversationId },
    data: { ticket_md: ticketMd },
  });
};
