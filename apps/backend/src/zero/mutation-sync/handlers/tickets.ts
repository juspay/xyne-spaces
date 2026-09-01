import type { Transaction } from '@rocicorp/zero';
import {
  Schema,
  serializeTicketMd,
  updateParentSubTicketsMdFromZero,
  syncTicketRelativesFromZero,
} from '@xyne/shared';
import type { TicketCardSummary } from '@xyne/shared';
import { zql } from '../../queries';
import { BaseMutationSyncHandler } from '../base-handler';

type TicketArgs = {
  id?: string;
  ticketId?: string;
} | undefined;

type TicketPreviousValue = {
  id?: string;
  conversationId?: string;
} | undefined;

export class TicketsMutationSyncHandler extends BaseMutationSyncHandler {
  async onInsert(args: unknown, tx: Transaction<Schema>): Promise<void> {
    await updateTicketMd(args, tx);
  }

  async onUpdate(args: unknown, tx: Transaction<Schema>): Promise<void> {
    await updateTicketMd(args, tx);
  }

  async onDelete(
    _args: unknown,
    tx: Transaction<Schema>,
    previousValue?: unknown
  ): Promise<void> {
    const previous = previousValue as TicketPreviousValue;
    const conversationId = previous?.conversationId;
    if (!conversationId) return;

    await tx.mutate.conversations.update({
      conversationId,
      ticket_md: null,
    });

    if (previous?.id) {
      await updateParentSubTicketsMdFromZero(tx, zql, previous.id);
    }
  }
}

const updateTicketMd = async (args: unknown, tx: Transaction<Schema>): Promise<void> => {
  const typedArgs = args as TicketArgs;
  const ticketId = typedArgs?.id || typedArgs?.ticketId;
  if (!ticketId) return;

  const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
  if (!ticket?.conversationId) return;

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
    zql.conversations.where('conversationId', ticket.conversationId).one()
  );
  if (!conversation) return;

  if (conversation.ticket_md === ticketMd) return;

  await tx.mutate.conversations.update({
    conversationId: ticket.conversationId,
    ticket_md: ticketMd,
  });

  await syncTicketRelativesFromZero(tx, zql, ticket.id);
};
