import type { Transaction } from '@rocicorp/zero';
import { MessageType } from './schema.js';
import type { Schema, Message } from './schema.js';
import {
  addReactionToData,
  parseReactionsMd,
  parseInitialMessageMd,
  removeReactionFromData,
  serializeReactionsMd,
  serializeRepliesMd,
  serializeInitialMessageMd,
} from '../utils/activityMetadataParser.js';
import type { InitialMessageSummary } from '../utils/activityMetadataParser.js';

export { parseRepliesMd, addReplyToData, serializeRepliesMd } from '../utils/activityMetadataParser.js';
import { zql } from './builder.js';

/**
 * Resolves a message by ID. First tries the local messages store. If not found
 * (e.g., initial messages only available via initial_message_md), falls back to
 * reconstructing a Message-shaped object from the conversation's initial_message_md.
 *
 * Returns `null` if the message can't be found anywhere.
 */
export async function resolveMessage(
  tx: Transaction<Schema>,
  messageId: string,
): Promise<Message | null> {
  const message = await tx.run(zql.messages.where('messageId', messageId).one());
  if (message) return message;

  // Message not in local store — try to reconstruct from initial_message_md
  const conversation = await tx.run(zql.conversations.where('initialMessageId', messageId).one());
  if (!conversation?.initial_message_md) return null;

  const summary = parseInitialMessageMd(conversation.initial_message_md);
  if (!summary || summary.messageId !== messageId) return null;

  return {
    messageId: summary.messageId,
    conversationId: summary.conversationId,
    senderId: summary.senderId,
    workspaceId: summary.workspaceId ?? null,
    content: summary.content,
    msgType: summary.msgType,
    hasAttachment: summary.hasAttachment,
    edited: summary.edited,
    isDeleted: summary.isDeleted,
    showInChannel: summary.showInChannel,
    visibleTo: summary.visibleTo ?? null,
    createdAt: summary.createdAt,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    metadata: summary.metadata ? JSON.parse(summary.metadata) : null,
    nudgeCount: summary.nudgeCount ?? null,
    isSent: summary.isSent,
    reactions_md: summary.reactions_md ?? null,
    link_preview_md: summary.link_preview_md ?? null,
    childConversationId: summary.childConversationId ?? null,
  };
}

export const isChatMessageType = (type: MessageType | null | undefined) =>
  type === MessageType.USER || type === MessageType.FORWARDED;

/**
 * Updates reactions_md on the message row. Returns the new reactions_md value
 * (or null if the message wasn't found / wasn't a chat type).
 */
export async function updateReactionsMd(
  tx: Transaction<Schema>,
  messageId: string,
  emojiName: string,
  userId: string,
  action: 'add' | 'remove',
): Promise<string | null> {
  const message = await tx.run(zql.messages.where('messageId', messageId).one());
  if (!message || !isChatMessageType(message.msgType)) {
    return null;
  }

  const data = parseReactionsMd(message.reactions_md);
  const updated =
    action === 'add'
      ? addReactionToData(data, emojiName, userId)
      : removeReactionFromData(data, emojiName, userId);
  const updatedMd = serializeReactionsMd(updated);

  if (updatedMd !== message.reactions_md) {
    await tx.mutate.messages.update({
      messageId,
      reactions_md: updatedMd,
    });
  }

  return updatedMd;
}

export function buildRepliesMdFromMessages(
  messages: Array<{
    messageId: string;
    senderId: string;
    createdAt: number;
    isDeleted: boolean;
    msgType: MessageType;
  }>,
  initialMessageId: string,
): string | null {
  const replyMessages = messages
    .filter(
      message =>
        !message.isDeleted &&
        message.messageId !== initialMessageId &&
        isChatMessageType(message.msgType),
    )
    .sort((a, b) => a.createdAt - b.createdAt);

  let repliers: string[] = [];
  for (const message of replyMessages) {
    repliers = repliers.filter(id => id !== message.senderId);
    repliers.push(message.senderId);
  }

  return serializeRepliesMd({ repliers });
}

/**
 * Updates reactions inside a conversation's initial_message_md directly.
 * Reads the conversation (not the message), parses the embedded reactions_md,
 * applies the add/remove, and writes back.
 */
export async function updateInitialMessageMdReaction(
  tx: Transaction<Schema>,
  messageId: string,
  emojiName: string,
  userId: string,
  action: 'add' | 'remove',
): Promise<void> {
  const conversation = await tx.run(zql.conversations.where('initialMessageId', messageId).one());
  if (!conversation?.initial_message_md) return;

  const summary = parseInitialMessageMd(conversation.initial_message_md);
  if (!summary) return;

  const data = parseReactionsMd(summary.reactions_md);
  const updated =
    action === 'add'
      ? addReactionToData(data, emojiName, userId)
      : removeReactionFromData(data, emojiName, userId);
  const updatedReactionsMd = serializeReactionsMd(updated);

  const updatedSummary: InitialMessageSummary = { ...summary, reactions_md: updatedReactionsMd };
  const md = serializeInitialMessageMd(updatedSummary);
  if (md === conversation.initial_message_md) return;

  await tx.mutate.conversations.update({
    conversationId: conversation.conversationId,
    initial_message_md: md,
  });
}

/**
 * Updates specific fields inside a conversation's initial_message_md.
 * Reads the conversation row (which IS in the client store), parses initial_message_md,
 * patches the changed fields, re-serializes, and writes back.
 * No messages table lookup needed.
 *
 * Use `conversationId` if known, or pass `messageId` to look up the conversation
 * by initialMessageId.
 */
export async function updateInitialMessageMdField(
  tx: Transaction<Schema>,
  lookup: { conversationId: string } | { messageId: string },
  fieldUpdates: Partial<InitialMessageSummary>,
): Promise<void> {
  let conversation;

  if ('conversationId' in lookup) {
    conversation = await tx.run(
      zql.conversations.where('conversationId', lookup.conversationId).one(),
    );
  } else {
    conversation = await tx.run(
      zql.conversations.where('initialMessageId', lookup.messageId).one(),
    );
  }

  if (!conversation?.initial_message_md) return;

  const summary = parseInitialMessageMd(conversation.initial_message_md);
  if (!summary) return;

  // Only update if this is the right message (when looked up by messageId)
  if ('messageId' in lookup && summary.messageId !== lookup.messageId) return;

  const updated: InitialMessageSummary = { ...summary, ...fieldUpdates };
  const md = serializeInitialMessageMd(updated);
  if (md === conversation.initial_message_md) return;

  await tx.mutate.conversations.update({
    conversationId: conversation.conversationId,
    initial_message_md: md,
  });
}
