import { logger } from '@/utils/logger';
import { deliverDelayedServerMessage } from '@/services/messageDeliveryService';

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
