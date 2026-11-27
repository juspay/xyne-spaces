import type { Transaction } from '@rocicorp/zero';
import {
  UnreadableString,
  buildInitialMessageMd,
  initialMessageMdTemplate,
  isCiphertextValue,
  reveal,
  parentMessageMdTemplate,
  parseParentMessageMd,
  resolveConversationAnchorType,
  updateParentSubTicketsMdFromZero,
} from '@xyne/shared';
import type { ComposeResult, MessageType, Schema } from '@xyne/shared';
import { compose } from '@/services/encryption/compose';
import { zql } from '../queries';
import { unreadableTransaction } from '../unreadableTransaction';

// Md columns made from a message's text (and a sub-ticket's anchor), built by compose so ciphertext
// never ends up inside an md and they are stored already encrypted.

/** A message row as a sync handler reads it: content and link_preview_md as stored. */
type StoredMessage = {
  messageId: string;
  conversationId: string;
  workspaceId?: string | null;
  senderId: string;
  content: string;
  msgType: string;
  createdAt: number;
  hasAttachment?: boolean;
  edited?: boolean;
  isDeleted?: boolean;
  showInChannel?: boolean;
  visibleTo?: string | null;
  metadata?: unknown;
  nudgeCount?: number | null;
  isSent?: boolean;
  reactions_md?: string | null;
  link_preview_md?: string | null;
  childConversationId?: string | null;
};

type TargetConversation = { conversationId: string; workspaceId: string };

function seal(value: string | null | undefined): UnreadableString | null | undefined {
  return value === null || value === undefined ? value : UnreadableString.make(value);
}

/** Rebuilds `conversation.initial_message_md` from `message`; writes it only when it changed. */
export async function composeInitialMessageMd(
  tx: Transaction<Schema>,
  message: StoredMessage,
  conversation: TargetConversation & { initial_message_md: string | null },
): Promise<void> {
  const result = await composeInitialMessageMdValue(message, conversation.initial_message_md, conversation.workspaceId);
  if (result.unchanged) return;
  // Written sealed: unreadableTransaction unwraps it for the database.
  await unreadableTransaction(tx, conversation.workspaceId).mutate.conversations.update({
    conversationId: conversation.conversationId,
    initial_message_md: result.value,
  });
}

/**
 * `initial_message_md` for `message`, composed (initialMessageMdTemplate): encrypted, or
 * `unchanged` when it equals `current`. Writes nothing: composeInitialMessageMd writes it through
 * Zero; the Prisma paths (conversationService, messageMetadataService) write it through Prisma.
 */
export async function composeInitialMessageMdValue(
  message: StoredMessage,
  current: string | null | undefined,
  workspaceId: string,
): Promise<ComposeResult> {
  return compose(
    {
      template: initialMessageMdTemplate,
      inputs: {
        messageId: message.messageId,
        conversationId: message.conversationId,
        workspaceId: message.workspaceId,
        senderId: message.senderId,
        content: UnreadableString.make(message.content),
        msgType: message.msgType,
        createdAt: message.createdAt,
        hasAttachment: message.hasAttachment,
        edited: message.edited,
        isDeleted: message.isDeleted,
        showInChannel: message.showInChannel,
        visibleTo: message.visibleTo,
        metadata: message.metadata,
        nudgeCount: message.nudgeCount,
        isSent: message.isSent,
        reactions_md: message.reactions_md,
        link_preview_md: seal(message.link_preview_md),
        childConversationId: message.childConversationId,
      },
      current: seal(current),
    },
    { workspaceId },
  );
}

/**
 * `initial_message_md` to store through Prisma (conversationService, messageMetadataService) for a
 * conversation's first message. Content held as plaintext (reads decrypt): built as before. Content
 * held as ciphertext (DEK passthrough, e.g. a bot's post through the ingress transit proxy): composed,
 * as the sync handlers do, so the stored block isn't that ciphertext encrypted again. With `current`,
 * an unchanged rebuild returns it, so callers comparing before writing skip the write.
 */
export async function initialMessageMdForPrisma(
  message: StoredMessage,
  current?: string | null,
): Promise<string | null> {
  if (!isCiphertextValue(message.content)) {
    return buildInitialMessageMd({ ...message, msgType: message.msgType as MessageType });
  }
  if (!message.workspaceId) {
    throw new Error('initial_message_md: the message content is encrypted, but its workspace is unknown');
  }
  const result = await composeInitialMessageMdValue(message, current, message.workspaceId);
  return result.unchanged ? (current ?? null) : reveal(result.value);
}

/** Rebuilds `conversation.parent_message_md` from its parent `message`; writes it only when it changed. */
export async function composeParentMessageMd(
  tx: Transaction<Schema>,
  message: Pick<StoredMessage, 'messageId' | 'conversationId' | 'senderId' | 'content' | 'msgType' | 'createdAt'>,
  conversation: TargetConversation & { parent_message_md: string | null },
): Promise<void> {
  const result = await compose(
    {
      template: parentMessageMdTemplate,
      inputs: {
        messageId: message.messageId,
        conversationId: message.conversationId,
        senderId: message.senderId,
        content: UnreadableString.make(message.content),
        msgType: message.msgType,
        createdAt: message.createdAt,
      },
      current: seal(conversation.parent_message_md),
    },
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
