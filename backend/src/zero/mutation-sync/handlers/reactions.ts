import type { Transaction } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { zql } from '../../queries';
import {
  addReactionToData,
  parseReactionsMd,
  removeReactionFromData,
  serializeReactionsMd,
  serializeInitialMessageMd,
} from '@xyne/shared';
import type { InitialMessageSummary } from '@xyne/shared';
import type { ReactionPreviousValue } from '../types';
import { BaseMutationSyncHandler } from '../base-handler';

export class ReactionsMutationSyncHandler extends BaseMutationSyncHandler {
  async onInsert(args: unknown, tx: Transaction<Schema>): Promise<void> {
    await handleReactionInsert(args, tx);
  }

  async onDelete(
    args: unknown,
    tx: Transaction<Schema>,
    previousValue?: unknown
  ): Promise<void> {
    await handleReactionDelete(args, tx, previousValue);
  }
}

async function syncInitialMessageMdAfterReaction(
  messageId: string,
  updatedReactionsMd: string | null,
  tx: Transaction<Schema>,
): Promise<void> {
  const message = await tx.run(zql.messages.where('messageId', messageId).one());
  if (!message) return;

  const conversations = await tx.run(
    zql.conversations.where('initialMessageId', message.messageId)
  );

  if (conversations.length === 0) return;

  const summary: InitialMessageSummary = {
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
    reactions_md: updatedReactionsMd,
    link_preview_md: message.link_preview_md,
    childConversationId: message.childConversationId,
  };

  const md = serializeInitialMessageMd(summary);

  for (const conversation of conversations) {
    if (conversation.initial_message_md === md) continue;
    await tx.mutate.conversations.update({
      conversationId: conversation.conversationId,
      initial_message_md: md,
    });
  }
}

async function handleReactionInsert(
  args: unknown,
  tx: Transaction<Schema>
): Promise<void> {
  const typedArgs = args as {
    messageId?: string;
    emojiName?: string;
    userId?: string;
  } | undefined;

  const messageId = typedArgs?.messageId;
  const emojiName = typedArgs?.emojiName;
  const reactingUserId = typedArgs?.userId;

  if (!messageId || !emojiName || !reactingUserId) {
    return;
  }

  const message = await tx.run(zql.messages.where('messageId', messageId).one());
  if (!message) {
    return;
  }

  const data = parseReactionsMd(message.reactions_md);
  const updatedData = addReactionToData(data, emojiName, reactingUserId);
  const updatedMd = serializeReactionsMd(updatedData);

  await tx.mutate.messages.update({
    messageId,
    reactions_md: updatedMd,
  });

  // Sync initial_message_md if this is the initial message
  await syncInitialMessageMdAfterReaction(messageId, updatedMd, tx);

  return;
}

async function handleReactionDelete(
  _args: unknown,
  tx: Transaction<Schema>,
  previousValue?: unknown
): Promise<void> {
  const reaction = previousValue as ReactionPreviousValue | undefined;
  if (!reaction?.messageId || !reaction.emojiName || !reaction.userId) {
    return;
  }

  const message = await tx.run(zql.messages.where('messageId', reaction.messageId).one());
  if (!message) {
    return;
  }

  const data = parseReactionsMd(message.reactions_md);
  const updatedData = removeReactionFromData(data, reaction.emojiName, reaction.userId);
  const updatedMd = serializeReactionsMd(updatedData);

  await tx.mutate.messages.update({
    messageId: reaction.messageId,
    reactions_md: updatedMd,
  });

  // Sync initial_message_md if this is the initial message
  await syncInitialMessageMdAfterReaction(reaction.messageId, updatedMd, tx);

  return;
}
