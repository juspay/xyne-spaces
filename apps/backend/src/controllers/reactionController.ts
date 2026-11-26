import { Request, Response } from 'express';

import { logger } from '../utils/logger';
import { addReactionAsUser } from '../services/reactionService';


export class ReactionController {






  async reactAsUser(req: Request, res: Response): Promise<void> {
    try {
      const { messageId, emojiName, userId } = (req.body ?? {}) as {
        messageId?: string;
        emojiName?: string;
        userId?: string;
      };

      if (!messageId || !emojiName || !userId) {
        res.status(400).json({ error: 'messageId, emojiName and userId are required' });
        return;
      }
      const emoji = emojiName.trim();
      if (!emoji || emoji.length > 100) {
        res.status(400).json({ error: 'Invalid emoji name' });
        return;
      }

      const reactions = await addReactionAsUser(messageId, userId, emoji);
      res.status(200).json({ success: true, reactions });

      logger.info(`[reactAsUser] ${emoji} as user ${userId} on message ${messageId}`);
    } catch (error) {
      logger.error('Error in reactAsUser:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

}
