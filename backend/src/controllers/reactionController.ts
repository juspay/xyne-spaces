import { Request, Response } from 'express';
import { ReactionRepository } from '../database/repositories/reactionRepository';
import { MessageRepository } from '../database/repositories/messageRepository';

import { logger } from '../utils/logger';
import { redisService } from '../services/redisService';
import {
  ReactionResponse,
  GetReactionsResponse,
  BulkReactionsResponse
} from '../api/types/ReactionTypes';

const reactionRepository = new ReactionRepository();
const messageRepository = new MessageRepository();

export class ReactionController {






  /**
   * Add a reaction to a message
   * POST /api/messages/:messageId/reactions
   */
  async addReaction(req: Request, res: Response): Promise<void> {
    try {
      const { messageId } = req.params;
      const { emojiName } = req.body;
      const userId = req.user!.id;

      if (!messageId || !emojiName) {
        res.status(400).json({ error: 'Message ID and emoji name are required' });
        return;
      }

      // Validate emoji name (basic validation - could be more sophisticated)
      if (!emojiName.trim() || emojiName.length > 100) {
        res.status(400).json({ error: 'Invalid emoji name' });
        return;
      }

      await reactionRepository.addReaction({
        messageId,
        userId,
        emojiName: emojiName.trim(),
      });

      // Get updated reactions for the message
      const reactions = await reactionRepository.getMessageReactions(messageId, userId);

      const response: ReactionResponse = {
        success: true,
        message: 'Reaction added successfully',
        reactions,
      };

      res.status(201).json(response);

      logger.info(`Reaction added: ${emojiName} by user ${userId} to message ${messageId}`);
    } catch (error: any) {
      if (error.code === 'P2002') {
        // Unique constraint violation - user already reacted with this emoji
        res.status(409).json({ error: 'You have already reacted with this emoji' });
        return;
      }

      logger.error('Error adding reaction:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Remove a reaction from a message
   * DELETE /api/messages/:messageId/reactions/:emojiName
   */
  async removeReaction(req: Request, res: Response): Promise<void> {
    try {
      const { messageId, emojiName } = req.params;
      const userId = req.user!.id;

      if (!messageId || !emojiName) {
        res.status(400).json({ error: 'Message ID and emoji name are required' });
        return;
      }

      await reactionRepository.removeReaction({
        messageId,
        userId,
        emojiName: decodeURIComponent(emojiName),
      });

      // Get updated reactions for the message
      const reactions = await reactionRepository.getMessageReactions(messageId, userId);

      const response: ReactionResponse = {
        success: true,
        message: 'Reaction removed successfully',
        reactions,
      };

      res.status(200).json(response);

      logger.info(`Reaction removed: ${emojiName} by user ${userId} from message ${messageId}`);
    } catch (error) {
      logger.error('Error removing reaction:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Toggle a reaction (add if not exists, remove if exists)
   * POST /api/messages/:messageId/reactions/:emojiName/toggle
   */
  async toggleReaction(req: Request, res: Response): Promise<void> {
    try {
      const { messageId, emojiName } = req.params;
      const userId = req.user!.id;

      if (!messageId || !emojiName) {
        res.status(400).json({ error: 'Message ID and emoji name are required' });
        return;
      }

      const decodedEmoji = decodeURIComponent(emojiName);

      // Validate emoji name
      if (!decodedEmoji.trim() || decodedEmoji.length > 100) {
        res.status(400).json({ error: 'Invalid emoji name' });
        return;
      }

      const result = await reactionRepository.toggleReaction({
        messageId,
        userId,
        emojiName: decodedEmoji,
      });

      // Get updated reactions for the message
      const reactions = await reactionRepository.getMessageReactions(messageId, userId);

      const response: ReactionResponse = {
        success: true,
        message: result.added ? 'Reaction added successfully' : 'Reaction removed successfully',
        added: result.added,
        reactions,
      };

      res.status(200).json(response);

      // Broadcast reaction change to other users in the conversation via WebSocket
      // Get the conversationId from the messageId to broadcast to the correct room
      try {
        const conversationId = await messageRepository.getConversationIdByMessageId(messageId);

        if (!conversationId) {
          logger.warn(`Could not find conversationId for messageId: ${messageId}`);
          return;
        }

        // Broadcast directly to WebSocket rooms (for same-pod users)
        // await websocketService.broadcastToSession(conversationId, 'reaction_updated', reactions);

        // Broadcast via Redis for cross-pod delivery using session_activity event
        await redisService.broadcastMessageToSession(conversationId, {
          messageId: `reaction-${messageId}-${Date.now()}`, // Unique ID for this reaction event
          conversationId,
          senderId: 'system', // System-generated event
          senderName: 'System',
          content: JSON.stringify({
            type: 'reaction_updated',
            data: reactions,
            messageId: messageId,
          }),
          msgType: 'SYSTEM',
          createdAt: new Date(),
        });

        logger.info(`Reaction broadcasted: ${decodedEmoji} by user ${userId} on message ${messageId} to conversation ${conversationId}`);
      } catch (broadcastError) {
        logger.error('Error broadcasting reaction update:', broadcastError);
        // Don't fail the request if broadcast fails
      }

      logger.info(`Reaction toggled: ${decodedEmoji} by user ${userId} on message ${messageId} (${result.added ? 'added' : 'removed'})`);
    } catch (error) {
      logger.error('Error toggling reaction:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get all reactions for a message
   * GET /api/messages/:messageId/reactions
   */
  async getMessageReactions(req: Request, res: Response): Promise<void> {
    try {
      const { messageId } = req.params;
      const userId = req.user!.id;

      if (!messageId) {
        res.status(400).json({ error: 'Message ID is required' });
        return;
      }

      const reactions = await reactionRepository.getMessageReactions(messageId, userId);

      const response: GetReactionsResponse = {
        reactions,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error getting message reactions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get reactions for multiple messages (used for conversation loading)
   * POST /api/messages/reactions/bulk
   */
  async getMessagesReactions(req: Request, res: Response): Promise<void> {
    try {
      const { messageIds } = req.body;
      const userId = req.user!.id;

      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        res.status(400).json({ error: 'Message IDs array is required' });
        return;
      }

      // Limit the number of messages to prevent abuse
      if (messageIds.length > 100) {
        res.status(400).json({ error: 'Too many message IDs (max 100)' });
        return;
      }

      const reactions = await reactionRepository.getMessagesReactions(messageIds, userId);

      const response: BulkReactionsResponse = {
        success: true,
        reactions,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error getting messages reactions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
