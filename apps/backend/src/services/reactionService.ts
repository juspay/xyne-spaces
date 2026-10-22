import { ReactionRepository } from '@/database/repositories/reactionRepository';
import { MessageRepository } from '@/database/repositories/messageRepository';
import { messageMetadataService } from '@/services/messageMetadataService';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

const reactionRepository = new ReactionRepository();
const messageRepository = new MessageRepository();

/**
 * React to a message as `userId`, a person or a bot, and show it live. Reacting twice
 * with the same emoji is a no-op. Returns the message's reactions as `userId` sees them.
 */
export async function addReactionAsUser(messageId: string, userId: string, emojiName: string) {
  try {
    await reactionRepository.addReaction({ messageId, userId, emojiName });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code !== 'P2002') throw error;
  }

  const conversationId = await messageRepository.getConversationIdByMessageId(messageId);
  try {
    await messageMetadataService.addReaction(messageId, emojiName, userId);
    if (conversationId) await messageMetadataService.syncInitialMessageMd(conversationId);
  } catch (error) {
    logger.error('[reactAsUser] failed to update reactions_md — emoji may not render:', error);
  }

  const reactions = await reactionRepository.getMessageReactions(messageId, userId);
  if (conversationId) {
    redisService
      .broadcastMessageToSession(conversationId, {
        messageId: `reaction-${messageId}-${Date.now()}`,
        conversationId,
        senderId: 'system',
        senderName: 'System',
        content: JSON.stringify({ type: 'reaction_updated', data: reactions, messageId }),
        msgType: 'SYSTEM',
        createdAt: new Date(),
      })
      .catch((error) => logger.error('Error broadcasting reactAsUser update:', error));
  }
  return reactions;
}
