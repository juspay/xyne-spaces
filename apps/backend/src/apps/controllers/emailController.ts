import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { getEmailReplies } from '../core/emailUtils';
import { resolveChannelId } from '../utils/channelUtils';

const EmailRepliesQuerySchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  conversationId: z.string().min(1, 'Conversation ID is required').trim(),
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 1000),
  cursor: z.string().optional(),
});

export class EmailController {
  /**
   * Get all emails in a conversation thread with cursor-based pagination
   * GET /api/external-event/email/emailReplies?channelId=xxx&conversationId=xxx&limit=1000&cursor=xxx
   */
  emailReplies = async (req: Request, res: Response): Promise<void> => {
    try {
      const queryResult = EmailRepliesQuerySchema.safeParse(req.query);

      if (!queryResult.success) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
        });
        return;
      }

      const { channelId, channelName, conversationId, limit, cursor } = queryResult.data;

      const resolvedChannelId = await resolveChannelId(channelId, conversationId, channelName);

      const response = await getEmailReplies(resolvedChannelId, conversationId, limit, cursor);

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error fetching email replies:', error);

      if (error instanceof Error) {
        if (error.message.includes('Invalid cursor format')) {
          res.status(400).json({
            error: error.message,
            code: 'INVALID_CURSOR',
          });
          return;
        }
        if (error.message.includes('not found')) {
          res.status(404).json({
            error: error.message,
            code: 'NOT_FOUND',
          });
          return;
        }
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
