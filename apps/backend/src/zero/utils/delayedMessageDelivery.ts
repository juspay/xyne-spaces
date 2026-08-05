import { logger } from '@/utils/logger';
import { deliverDelayedServerMessage } from '@/services/messageDeliveryService';
import { db } from '@/database/client';

export interface DeliverDelayedMessageInput {
  delayedMessageId: string;
  channelId: string;
  conversationId: string | null | undefined;
  senderId: string;
  content: string;
  hasAttachment: boolean;
}

export interface DeliverDelayedMessageResult {
  success: boolean;
  error?: string;
  conversationId?: string;
  messageId?: string;
}

/** Deliver a scheduled message through server-side service composition. */
export async function deliverDelayedMessage(
  input: DeliverDelayedMessageInput,
): Promise<DeliverDelayedMessageResult> {
  const { channelId, conversationId, senderId, content } = input;
  try {
    // A scheduled message carries both channelId and conversationId. Authorization is
    // performed against the channel, so require the conversation to belong to that channel
    // before delivering. Enforced here because both the send-now and scheduled-worker paths
    // funnel through this function.
    if (conversationId) {
      const conversation = await db.conversation.findUnique({
        where: { conversationId },
        select: { channelId: true },
      });
      if (!conversation || conversation.channelId !== channelId) {
        logger.warn(
          `[DELAYED-MSG-DELIVERY] Refusing delivery: conversation ${conversationId} does not belong to channel ${channelId}`,
        );
        return { success: false, error: 'Conversation does not belong to this channel' };
      }
    }

    if (!conversationId) {
      logger.info(
        `[DELAYED-MSG-DELIVERY] Delivering as new conversation: channelId=${channelId}, senderId=${senderId}`,
      );
    } else {
      logger.info(
        `[DELAYED-MSG-DELIVERY] Delivering as reply: conversationId=${conversationId}, senderId=${senderId}`,
      );
    }

    const result = await deliverDelayedServerMessage({
      delayedMessageId: input.delayedMessageId,
      channelId,
      conversationId,
      senderId,
      content,
    });

    return {
      success: true,
      conversationId: result.conversationId,
      messageId: result.messageId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
