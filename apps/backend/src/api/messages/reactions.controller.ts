import { MessageType, api } from '@xyne/shared';
import { MessageRepository } from '@/database/repositories/messageRepository';
import { ReactionRepository } from '@/database/repositories/reactionRepository';
import { ContractError, controller } from '@/framework/api';
import { redisService } from '@/services/redisService';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';

/**
 * Message reactions on the typed framework (routes/reactionRoutes.ts): no req/res, same answers
 * as the ReactionController methods they replace.
 */

const reactionRepository = new ReactionRepository();
const messageRepository = new MessageRepository();

const userIdOf = (user: AuthenticatedUser | undefined) => user!.id;
const internal = (error: unknown, logMessage: string) => {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, { error: 'Internal server error' });
};

/** POST /messages/:messageId/reactions */
export const addReaction = controller(api.messages.reactions.add, async (input) => {
  try {
    const { messageId } = input.params;
    const { emojiName } = input.body;
    const userId = userIdOf(input.user);
    // Basic emoji-name check (could be more sophisticated)
    if (!emojiName.trim() || emojiName.length > 100) throw new ContractError(400, { error: 'Invalid emoji name' });

    await reactionRepository.addReaction({ messageId, userId, emojiName: emojiName.trim() });
    const reactions = await reactionRepository.getMessageReactions(messageId, userId);
    logger.info(`Reaction added: ${emojiName} by user ${userId} to message ${messageId}`);
    return { success: true as const, message: 'Reaction added successfully', reactions };
  } catch (error) {
    // Unique constraint violation: the user already reacted with this emoji
    if ((error as { code?: string }).code === 'P2002') {
      throw new ContractError(409, { error: 'You have already reacted with this emoji' });
    }
    throw internal(error, 'Error adding reaction:');
  }
});

/** DELETE /messages/:messageId/reactions/:emojiName */
export const removeReaction = controller(api.messages.reactions.remove, async (input) => {
  try {
    const { messageId, emojiName } = input.params;
    const userId = userIdOf(input.user);
    await reactionRepository.removeReaction({ messageId, userId, emojiName: decodeURIComponent(emojiName) });
    const reactions = await reactionRepository.getMessageReactions(messageId, userId);
    logger.info(`Reaction removed: ${emojiName} by user ${userId} from message ${messageId}`);
    return { success: true as const, message: 'Reaction removed successfully', reactions };
  } catch (error) {
    throw internal(error, 'Error removing reaction:');
  }
});

/** POST /messages/:messageId/reactions/:emojiName/toggle: adds, or removes if it was there. */
export const toggleReaction = controller(api.messages.reactions.toggle, async (input) => {
  try {
    const { messageId, emojiName } = input.params;
    const userId = userIdOf(input.user);
    const decodedEmoji = decodeURIComponent(emojiName);
    if (!decodedEmoji.trim() || decodedEmoji.length > 100) throw new ContractError(400, { error: 'Invalid emoji name' });

    const result = await reactionRepository.toggleReaction({ messageId, userId, emojiName: decodedEmoji });
    const reactions = await reactionRepository.getMessageReactions(messageId, userId);

    // Tell the others in the conversation (cross-pod, via Redis). Not awaited: the caller's answer
    // does not wait for it, and a failure never fails the request.
    void broadcastReactionUpdate(messageId, reactions, decodedEmoji, userId);

    logger.info(`Reaction toggled: ${decodedEmoji} by user ${userId} on message ${messageId} (${result.added ? 'added' : 'removed'})`);
    return {
      success: true as const,
      message: result.added ? 'Reaction added successfully' : 'Reaction removed successfully',
      added: result.added,
      reactions,
    };
  } catch (error) {
    throw internal(error, 'Error toggling reaction:');
  }
});

async function broadcastReactionUpdate(messageId: string, reactions: unknown, emoji: string, userId: string): Promise<void> {
  try {
    const conversationId = await messageRepository.getConversationIdByMessageId(messageId);
    if (!conversationId) {
      logger.warn(`Could not find conversationId for messageId: ${messageId}`);
      return;
    }
    await redisService.broadcastMessageToSession(conversationId, {
      messageId: `reaction-${messageId}-${Date.now()}`, // Unique ID for this reaction event
      conversationId,
      senderId: 'system', // System-generated event
      senderName: 'System',
      content: JSON.stringify({ type: 'reaction_updated', data: reactions, messageId }),
      msgType: MessageType.SYSTEM,
      createdAt: new Date(),
    });
    logger.info(`Reaction broadcasted: ${emoji} by user ${userId} on message ${messageId} to conversation ${conversationId}`);
  } catch (broadcastError) {
    logger.error('Error broadcasting reaction update:', broadcastError);
  }
}

/** GET /messages/:messageId/reactions */
export const getMessageReactions = controller(api.messages.reactions.get, async (input) => {
  try {
    return { reactions: await reactionRepository.getMessageReactions(input.params.messageId, userIdOf(input.user)) };
  } catch (error) {
    throw internal(error, 'Error getting message reactions:');
  }
});

/** POST /messages/reactions/bulk */
export const getMessagesReactions = controller(api.messages.reactions.bulk, async (input) => {
  try {
    return { success: true as const, reactions: await reactionRepository.getMessagesReactions(input.body.messageIds, userIdOf(input.user)) };
  } catch (error) {
    throw internal(error, 'Error getting messages reactions:');
  }
});