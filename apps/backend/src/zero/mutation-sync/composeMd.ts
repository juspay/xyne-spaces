import type { Transaction } from '@rocicorp/zero';
import {
  UnreadableString,
  initialMessageMdTemplate,
  parentMessageMdTemplate,
  parseParentMessageMd,
  resolveConversationAnchorType,
  updateParentSubTicketsMdFromZero,
} from '@xyne/shared';
import type { Schema } from '@xyne/shared';
import { compose } from '@/services/encryption/compose';
import { seal, storedInputs } from '@/services/encryption/mdCompose';
import { zql } from '../queries';
import { unreadableTransaction } from '../unreadableTransaction';

// Md columns made from a message's text (and a sub-ticket's anchor), built by compose so ciphertext
// never ends up inside an md and they are stored already encrypted.

type TargetConversation = { conversationId: string; workspaceId: string };

/** Rebuilds `conversation.initial_message_md` from `message`; writes it only when it changed. */
export async function composeInitialMessageMd(
  tx: Transaction<Schema>,
  message: object,
  conversation: TargetConversation & { initial_message_md: string | null },
): Promise<void> {
  const result = await compose(
    { template: initialMessageMdTemplate, inputs: storedInputs(initialMessageMdTemplate, message), current: seal(conversation.initial_message_md) },
    { workspaceId: conversation.workspaceId },
  );
  if (result.unchanged) return;
  // Written sealed: unreadableTransaction unwraps it for the database.
  await unreadableTransaction(tx, conversation.workspaceId).mutate.conversations.update({
    conversationId: conversation.conversationId,
    initial_message_md: result.value,
  });
}

/** Rebuilds `conversation.parent_message_md` from its parent `message`; writes it only when it changed. */
export async function composeParentMessageMd(
  tx: Transaction<Schema>,
  message: object,
  conversation: TargetConversation & { parent_message_md: string | null },
): Promise<void> {
  const result = await compose(
    { template: parentMessageMdTemplate, inputs: storedInputs(parentMessageMdTemplate, message), current: seal(conversation.parent_message_md) },
    { workspaceId: conversation.workspaceId },
  );
  if (result.unchanged) return;
  // Written sealed: unreadableTransaction unwraps it for the database.
  await unreadableTransaction(tx, conversation.workspaceId).mutate.conversations.update({
    conversationId: conversation.conversationId,
    parent_message_md: result.value,
  });
}

/**
 * Links sub-ticket `childTicketId`'s conversation to its parent ticket's: its parent_message_md
 * becomes a SUBTICKET anchor on the parent's initial message, unless it already anchors a thread.
 * `linkSubTicketConversationToParentFromZero` on the server, with the md built by compose.
 */
export async function composeSubTicketAnchorMd(
  tx: Transaction<Schema>,
  childTicketId: string,
  parentTicketId: string,
): Promise<void> {
  const child = await tx.run(zql.tickets.where('id', childTicketId).one());
  if (!child?.conversationId) return;
  const parent = await tx.run(zql.tickets.where('id', parentTicketId).one());
  if (!parent?.conversationId) return;
  if (child.conversationId === parent.conversationId) return;

  const parentConversation = await tx.run(zql.conversations.where('conversationId', parent.conversationId).one());
  if (!parentConversation?.initialMessageId) return;
  const conversation = await tx.run(zql.conversations.where('conversationId', child.conversationId).one());
  if (!conversation) return;

  // A thread's anchor is kept (writeConversationAnchorFromZero).
  const existing = parseParentMessageMd(conversation.parent_message_md);
  if (existing && resolveConversationAnchorType(existing) !== 'SUBTICKET') return;

  const result = await compose(
    {
      template: parentMessageMdTemplate,
      inputs: {
        messageId: parentConversation.initialMessageId,
        conversationId: parent.conversationId,
        channelId: parent.channelId ?? null,
        senderId: parent.createdBy,
        content: UnreadableString.make(`${parent.xyneId} · ${parent.title}`),
        msgType: 'SYSTEM',
        createdAt: parent.createdAt,
        anchorType: 'SUBTICKET',
      },
      current: seal(conversation.parent_message_md),
    },
    { workspaceId: conversation.workspaceId },
  );
  if (result.unchanged) return;
  // Written sealed: unreadableTransaction unwraps it for the database.
  await unreadableTransaction(tx, conversation.workspaceId).mutate.conversations.update({
    conversationId: child.conversationId,
    parentMessageId: parentConversation.initialMessageId,
    parent_message_md: result.value,
  });
}

/** `syncTicketRelativesFromZero` on the server: the sub-ticket anchors through composeSubTicketAnchorMd. */
export async function syncTicketRelatives(tx: Transaction<Schema>, ticketId: string): Promise<void> {
  await updateParentSubTicketsMdFromZero(tx, zql, ticketId);

  const childMappings = await tx.run(zql.ticket_sub_ticket_mappings.where('ticketId', ticketId));
  for (const mapping of childMappings) {
    const subTicket = await tx.run(zql.sub_tickets.where('id', mapping.subTicketId).one());
    if (subTicket?.mappedTicketId && subTicket.mappedTicketId !== ticketId) {
      await composeSubTicketAnchorMd(tx, subTicket.mappedTicketId, ticketId);
    }
  }
}
