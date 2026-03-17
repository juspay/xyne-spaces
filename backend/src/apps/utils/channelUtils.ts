import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';

/**
 * Resolve channelId from conversationId if channelId is not provided
 * 
 * @param channelId - Channel ID (optional)
 * @param conversationId - Conversation ID (optional)
 * @returns Resolved channel ID
 * @throws Error if neither channelId nor conversationId is provided, or if conversation is not found
 */
export async function resolveChannelId(
  channelId: string | undefined,
  conversationId: string | undefined
): Promise<string> {
  if (channelId) {
    return channelId;
  }

  if (!conversationId) {
    throw new Error('Either channelId or conversationId is required');
  }

  logger.info(`[CHANNEL-UTILS] Resolving channelId from conversationId: ${conversationId}`);
  const conversation = await repositories.conversations.findById(conversationId);
  
  if (!conversation) {
    logger.warn(`[CHANNEL-UTILS] Conversation not found: ${conversationId}`);
    throw new Error('Conversation not found');
  }

  logger.info(`[CHANNEL-UTILS] Resolved channelId: ${conversation.channelId} from conversationId: ${conversationId}`);
  return conversation.channelId;
}
