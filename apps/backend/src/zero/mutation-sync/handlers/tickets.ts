import type { Transaction } from '@rocicorp/zero';
import {
  Schema,
  updateParentSubTicketsMdFromZero,
  syncTicketRelativesFromZero,
} from '@xyne/shared';
import { zql } from '../../queries';
import { BaseMutationSyncHandler } from '../base-handler';
import { composeTicketMd } from '../composeMd';

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

  const conversation = await tx.run(
    zql.conversations.where('conversationId', ticket.conversationId).one()
  );
  if (!conversation) return;

  // The description is unreadable, so the encryption service builds ticket_md (ticketMdTemplate).
  if (!(await composeTicketMd(tx, ticket, conversation))) return;

  await syncTicketRelativesFromZero(tx, zql, ticket.id);
};
