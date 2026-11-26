import type { Transaction } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { zql } from '../../queries';
import { BaseMutationSyncHandler } from '../base-handler';
import { composeInitialMessageMd, composeParentMessageMd } from '../composeMd';

export class ConversationsMutationSyncHandler extends BaseMutationSyncHandler {
  async onInsert(args: unknown, tx: Transaction<Schema>): Promise<void> {
    await handleConversationInsert(args, tx);
  }
}

async function handleConversationInsert(
  args: unknown,
  tx: Transaction<Schema>,
): Promise<void> {
  const typedArgs = args as { conversationId?: string } | undefined;
  const conversationId = typedArgs?.conversationId;

  if (!conversationId) {
    return;
  }

  const conversation = await tx.run(
    zql.conversations.where('conversationId', conversationId).one(),
  );

  if (!conversation) {
    return;
  }

  // Sync initial_message_md if missing and initialMessageId is set
  if (conversation.initialMessageId && !conversation.initial_message_md) {
    const message = await tx.run(
      zql.messages.where('messageId', conversation.initialMessageId).one(),
    );

    if (message) {
      await composeInitialMessageMd(tx, message, conversation);
    }
  }

  // Sync parent_message_md if missing and parentMessageId is set
  if (conversation.parentMessageId && !conversation.parent_message_md) {
    const parentMessage = await tx.run(
      zql.messages.where('messageId', conversation.parentMessageId).one(),
    );

    if (parentMessage) {
      await composeParentMessageMd(tx, parentMessage, conversation);
    }
  }
}
