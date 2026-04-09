import type { Transaction } from '@rocicorp/zero';
import { MessageType, Schema } from '@xyne/shared';
import { zql } from '../../queries';
import {
  addReplyToData,
  parseRepliesMd,
  serializeRepliesMd,
  serializeInitialMessageMd,
  serializeParentMessageMd,
} from '@xyne/shared';
import type { InitialMessageSummary, ParentMessageSummary } from '@xyne/shared';
import type { MessagePreviousValue } from '../types';
import { BaseMutationSyncHandler } from '../base-handler';

export class MessagesMutationSyncHandler extends BaseMutationSyncHandler {
  async onInsert(args: unknown, tx: Transaction<Schema>): Promise<void> {
    await handleMessageInsert(args, tx);
  }

  async onUpdate(args: unknown, tx: Transaction<Schema>): Promise<void> {
    await handleMessageUpdate(args, tx);
  }

  async onDelete(
    args: unknown,
    tx: Transaction<Schema>,
    previousValue?: unknown
  ): Promise<void> {
    await handleMessageDelete(args, tx, previousValue);
  }
}

function buildInitialMessageSummary(
  message: {
    messageId: string;
    conversationId: string;
    senderId: string;
    content: string;
    msgType: MessageType;
    hasAttachment: boolean;
    edited: boolean;
    isDeleted: boolean;
    showInChannel: boolean;
    visibleTo: string | null;
    createdAt: number;
    metadata: unknown;
    nudgeCount: number | null;
    isSent: boolean;
    reactions_md: string | null;
    link_preview_md: string | null;
    childConversationId: string | null;
  },
): InitialMessageSummary {
  return {
    messageId: message.messageId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    content: message.content,
    msgType: message.msgType,
    hasAttachment: message.hasAttachment,
    edited: message.edited,
    isDeleted: message.isDeleted,
    showInChannel: message.showInChannel,
    visibleTo: message.visibleTo,
    createdAt: message.createdAt,
    metadata: message.metadata ? JSON.stringify(message.metadata) : null,
    nudgeCount: message.nudgeCount,
    isSent: message.isSent,
    reactions_md: message.reactions_md,
    link_preview_md: message.link_preview_md,
    childConversationId: message.childConversationId,
  };
}

function buildParentMessageSummary(
  message: {
    messageId: string;
    conversationId: string;
    senderId: string;
    content: string;
    msgType: MessageType;
    createdAt: number;
  },
): ParentMessageSummary {
  return {
    messageId: message.messageId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    content: message.content,
    msgType: message.msgType,
    createdAt: message.createdAt,
  };
}

async function syncInitialMessageMd(
  message: Parameters<typeof buildInitialMessageSummary>[0],
  conversation: { conversationId: string; initial_message_md: string | null },
  tx: Transaction<Schema>,
): Promise<void> {
  const summary = buildInitialMessageSummary(message);
  const md = serializeInitialMessageMd(summary);

  if (conversation.initial_message_md === md) return;

  await tx.mutate.conversations.update({
    conversationId: conversation.conversationId,
    initial_message_md: md,
  });
}

async function syncParentMessageMdForMessage(
  message: Parameters<typeof buildParentMessageSummary>[0],
  tx: Transaction<Schema>,
): Promise<void> {
  // Find conversations where this message is the parentMessage
  const conversations = await tx.run(
    zql.conversations.where('parentMessageId', message.messageId),
  );

  if (conversations.length === 0) return;

  const summary = buildParentMessageSummary(message);
  const md = serializeParentMessageMd(summary);

  for (const conv of conversations) {
    if (conv.parent_message_md === md) continue;
    await tx.mutate.conversations.update({
      conversationId: conv.conversationId,
      parent_message_md: md,
    });
  }
}

async function handleMessageInsert(
  args: unknown,
  tx: Transaction<Schema>
): Promise<void> {
  const typedArgs = args as { messageId?: string } | undefined;
  const messageId = typedArgs?.messageId;

  if (!messageId) {
    return;
  }

  const message = await tx.run(zql.messages.where('messageId', messageId).one());
  if (!message) {
    return;
  }

  const conversation = await tx.run(
    zql.conversations.where('conversationId', message.conversationId).one()
  );

  if (!conversation?.initialMessageId || !conversation.channelId) {
    return;
  }

  // Sync initial_message_md if this IS the initial message
  if (conversation.initialMessageId === message.messageId) {
    await syncInitialMessageMd(message, conversation, tx);
    // Also check if this message is a parent of other conversations
    await syncParentMessageMdForMessage(message, tx);
    return;
  }

  // Skip replies_md update for system messages
  if (message.msgType === MessageType.SYSTEM) {
    return;
  }

  const repliesData = parseRepliesMd(conversation.replies_md);
  const updatedRepliesData = addReplyToData(repliesData, message.senderId);
  const updatedRepliesMd = serializeRepliesMd(updatedRepliesData);

  await tx.mutate.conversations.update({
    conversationId: conversation.conversationId,
    replies_md: updatedRepliesMd,
  });

  return;
}

async function handleMessageUpdate(
  args: unknown,
  tx: Transaction<Schema>
): Promise<void> {
  const typedArgs = args as { messageId?: string } | undefined;
  const messageId = typedArgs?.messageId;

  if (!messageId) {
    return;
  }

  const message = await tx.run(zql.messages.where('messageId', messageId).one());
  if (!message) {
    return;
  }

  const initialMessageConversations = await tx.run(
    zql.conversations.where('initialMessageId', message.messageId)
  );

  for (const conversation of initialMessageConversations) {
    await syncInitialMessageMd(message, conversation, tx);
  }

  // Check if this message is a parent message of any conversation
  await syncParentMessageMdForMessage(message, tx);
}

async function handleMessageDelete(
  _args: unknown,
  tx: Transaction<Schema>,
  previousValue?: unknown
): Promise<void> {
  const message = previousValue as MessagePreviousValue | undefined;
  if (!message || message.msgType === MessageType.SYSTEM) {
    return;
  }

  const conversation = await tx.run(
    zql.conversations.where('conversationId', message.conversationId).one()
  );

  if (!conversation?.initialMessageId || !conversation.channelId) {
    return;
  }

  if (conversation.initialMessageId === message.messageId) {
    return;
  }

  const replies = await tx.run(
    zql.messages
      .where('conversationId', message.conversationId)
      .where('isDeleted', false)
      .where('messageId', '!=', conversation.initialMessageId)
      .orderBy('createdAt', 'asc')
  );

  let repliers: string[] = [];
  for (const reply of replies) {
    repliers = repliers.filter(id => id !== reply.senderId);
    repliers.push(reply.senderId);
  }

  const updatedRepliesMd = serializeRepliesMd({ repliers });

  await tx.mutate.conversations.update({
    conversationId: message.conversationId,
    replies_md: updatedRepliesMd,
  });

  return;
}
