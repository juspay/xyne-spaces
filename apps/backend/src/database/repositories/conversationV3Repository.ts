import { Conversation, MessageAttachment, SurfaceNudgeCount } from '@prisma/client';
import { DatabaseClient } from '../client';

export interface ConversationV3Data {
  conversation: Conversation;
  attachments: MessageAttachment[];
  nudgeCounts: SurfaceNudgeCount[];
}

export class ConversationV3Repository {
  private db = DatabaseClient.getInstance();

  /**
   * Get a conversation by message ID with all required relations for V3 serialization.
   * This fetches the conversation that contains the given message, along with:
   * - initialMessageAttachments (attachments for the conversation's initial message)
   * - initialMessageNudgeCounts (nudge counts for the conversation's initial message)
   */
  async getConversationByMessageId(messageId: string): Promise<ConversationV3Data | null> {
    // Step 1: Find the message to get its conversationId
    const message = await this.db.message.findUnique({
      where: { messageId },
      select: { conversationId: true },
    });

    if (!message?.conversationId) {
      return null;
    }

    // Step 2: Find the conversation by conversationId
    const conversation = await this.db.conversation.findUnique({
      where: { conversationId: message.conversationId },
    });

    if (!conversation) {
      return null;
    }

    // Step 3: Fetch initialMessageAttachments and initialMessageNudgeCounts in parallel
    const [attachments, nudgeCounts] = await Promise.all([
      this.db.messageAttachment.findMany({
        where: {
          entityId: conversation.initialMessageId,
          entityType: 'CHAT',
        },
      }),
      this.db.surfaceNudgeCount.findMany({
        where: {
          messageId: conversation.initialMessageId,
        },
      }),
    ]);

    return {
      conversation,
      attachments,
      nudgeCounts,
    };
  }

  /**
   * Get a conversation directly by conversation ID with all required relations for V3 serialization.
   */
  async getConversationById(conversationId: string): Promise<ConversationV3Data | null> {
    const conversation = await this.db.conversation.findUnique({
      where: { conversationId },
    });

    if (!conversation) {
      return null;
    }

    // Fetch initialMessageAttachments and initialMessageNudgeCounts in parallel
    const [attachments, nudgeCounts] = await Promise.all([
      this.db.messageAttachment.findMany({
        where: {
          entityId: conversation.initialMessageId,
          entityType: 'CHAT',
        },
      }),
      this.db.surfaceNudgeCount.findMany({
        where: {
          messageId: conversation.initialMessageId,
        },
      }),
    ]);

    return {
      conversation,
      attachments,
      nudgeCounts,
    };
  }
}