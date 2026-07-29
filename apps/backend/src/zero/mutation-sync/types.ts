import type { Schema } from '@xyne/shared';
import type { Transaction } from '@rocicorp/zero';
import type { MessageType } from '@xyne/shared';
import type { TableName } from '../acl/core/types';

export type MutationSyncOperation = 'insert' | 'update' | 'upsert' | 'delete';

export type ReactionPreviousValue = {
  messageId: string;
  emojiName: string;
  userId: string;
};

export type MessagePreviousValue = {
  messageId: string;
  conversationId: string;
  senderId: string;
  msgType: MessageType;
};

export type MutationSyncCollector = (params: {
  table: TableName;
  operation: MutationSyncOperation;
  args: unknown;
  tx: Transaction<Schema>;
}) => Promise<unknown> | unknown;
