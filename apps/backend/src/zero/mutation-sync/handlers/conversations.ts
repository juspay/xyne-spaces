import type { Transaction } from '@rocicorp/zero';
import { MessageType, Schema } from '@xyne/shared';
import { zql } from '../../queries';
import {
  buildInitialMessageMd,
  serializeParentMessageMd,
} from '@xyne/shared';
import type { ParentMessageSummary } from '@xyne/shared';
import { BaseMutationSyncHandler } from '../base-handler';

export class ConversationsMutationSyncHandler extends BaseMutationSyncHandler {
  async onInsert(args: unknown, tx: Transaction<Schema>): Promise<void> {
    await handleConversationInsert(args, tx);
  }
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
      await tx.mutate.conversations.update({
        conversationId,
        initial_message_md: buildInitialMessageMd(message),
      });
    }
  }

  // Sync parent_message_md if missing and parentMessageId is set
  if (conversation.parentMessageId && !conversation.parent_message_md) {
    const parentMessage = await tx.run(
      zql.messages.where('messageId', conversation.parentMessageId).one(),
    );

    if (parentMessage) {
      await tx.mutate.conversations.update({
        conversationId,
        parent_message_md: serializeParentMessageMd(buildParentMessageSummary(parentMessage)),
      });
    }
  }
}
