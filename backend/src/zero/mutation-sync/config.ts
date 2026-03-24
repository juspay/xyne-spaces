import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import type { TableName } from '../acl/core/types';
import type { MutationSyncCollector, MutationSyncOperation } from './types';
import { zql } from '../queries';

type MutationSyncConfig = Partial<
  Record<TableName, Partial<Record<MutationSyncOperation, MutationSyncCollector>>>
>;

const mutationSyncConfig: MutationSyncConfig = {
  reactions: {
    delete: async ({ args, tx }) => {
      const typedArgs = args as { reactionId?: string } | undefined;
      if (!typedArgs?.reactionId) return undefined;

      const reaction = await tx.run(
        zql.reactions.where('reactionId', typedArgs.reactionId).one()
      );

      if (!reaction) return undefined;

      return {
        messageId: reaction.messageId,
        emojiName: reaction.emojiName,
        userId: reaction.userId,
      };
    },
  },
  messages: {
    delete: async ({ args, tx }) => {
      const typedArgs = args as { messageId?: string } | undefined;
      if (!typedArgs?.messageId) return undefined;

      const message = await tx.run(
        zql.messages.where('messageId', typedArgs.messageId).one()
      );

      if (!message) return undefined;

      return {
        messageId: message.messageId,
        conversationId: message.conversationId,
        senderId: message.senderId,
        msgType: message.msgType,
      };
    },
  },
};

export async function collectMutationSyncPreviousValue(
  table: TableName,
  operation: MutationSyncOperation,
  args: unknown,
  tx: Transaction<Schema>
): Promise<unknown> {
  const tableConfig = mutationSyncConfig[table];
  const collector = tableConfig?.[operation];
  if (!collector) return undefined;

  return collector({ table, operation, args, tx });
}
