import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';

/**
 * Resolve channelId from channelName or conversationId if channelId is not provided
 * 
 * @param channelId - Channel ID (optional)
 * @param conversationId - Conversation ID (optional)
 * @param channelName - Channel name (optional)
 * @returns Resolved channel ID
 * @throws Error if no identifier is provided, or if the resource is not found
 */
export async function resolveChannelId(
  channelId: string | undefined,
  conversationId: string | undefined,
  channelName?: string | undefined
): Promise<string> {
  if (channelId) {
    return channelId;
  }

  if (channelName) {
    logger.info(`[CHANNEL-UTILS] Resolving channelId from channelName: ${channelName}`);
    const channel = await repositories.channels.findByName(channelName);
    if (!channel) {
      logger.warn(`[CHANNEL-UTILS] Channel not found by name: ${channelName}`);
      throw new Error('Channel not found');
    }
    logger.info(`[CHANNEL-UTILS] Resolved channelId: ${channel.id} from channelName: ${channelName}`);
    return channel.id;
  }

  if (!conversationId) {
    throw new Error('Either channelId, channelName, or conversationId is required');
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
