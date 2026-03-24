import type { Transaction } from '@rocicorp/zero';
import { MessageType, Schema } from '@xyne/shared';
import { zql } from '../../queries';
import {
  addReplyToData,
  parseRepliesMd,
  serializeRepliesMd,
} from '@xyne/shared';
import type { MessagePreviousValue } from '../types';
import { BaseMutationSyncHandler } from '../base-handler';

export class MessagesMutationSyncHandler extends BaseMutationSyncHandler {
  async onInsert(args: unknown, tx: Transaction<Schema>): Promise<void> {
    await handleMessageInsert(args, tx);
  }

  async onDelete(
    args: unknown,
    tx: Transaction<Schema>,
    previousValue?: unknown
  ): Promise<void> {
    await handleMessageDelete(args, tx, previousValue);
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

  const repliesData = parseRepliesMd(conversation.replies_md);
  const updatedRepliesData = addReplyToData(repliesData, message.senderId);
  const updatedRepliesMd = serializeRepliesMd(updatedRepliesData);

  await tx.mutate.conversations.update({
    conversationId: conversation.conversationId,
    replies_md: updatedRepliesMd,
  });

  return;
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
