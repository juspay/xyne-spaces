import type { Transaction } from '@rocicorp/zero';
import { MessageType, Schema } from '@xyne/shared';
import { zql } from '../../queries';
import {
  serializeInitialMessageMd,
  serializeParentMessageMd,
} from '@xyne/shared';
import type { InitialMessageSummary, ParentMessageSummary } from '@xyne/shared';
import { BaseMutationSyncHandler } from '../base-handler';

export class ConversationsMutationSyncHandler extends BaseMutationSyncHandler {
  async onInsert(args: unknown, tx: Transaction<Schema>): Promise<void> {
    await handleConversationInsert(args, tx);
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
        initial_message_md: serializeInitialMessageMd(buildInitialMessageSummary(message)),
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
