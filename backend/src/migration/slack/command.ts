/**
 * Slack Migration Command Handler
 * Handles /sync command - opens modal
 */

import { Router, Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import { logger } from '../../utils/logger';
import { getSyncModal } from './utils/blockKit';
import { verifySlackRequest } from './middleware/verifySlackRequest';
import { config } from '../../config/env';

const router = Router();

router.post('/command', verifySlackRequest, async (req: Request, res: Response) => {
  try {
    const { trigger_id, channel_id, user_id } = req.body;

    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      logger.error('[Migration] SLACK_BOT_TOKEN is not set');
      return res.status(200).json({
        response_type: 'ephemeral',
        text: 'Slack integration is not configured.',
      });
    }

    // Check if user is authorized to run migrations
    const approvedUsers = config.slackMigrationApprovals;

    if (approvedUsers.length > 0) {
      if (!user_id) {
        logger.warn('[Migration] No user_id provided in /sync command');

        return res.status(200).json({
          response_type: 'ephemeral',
          text: '❌ User ID is required for authorization.',
        });
      }

      if (!approvedUsers.includes(user_id)) {
        logger.warn('[Migration] Unauthorized user attempted /sync command', {
          userId: user_id,
          approvedUsers: approvedUsers,
        });

        let messageText = ':sadblob: You are not authorized to perform this action.\n\n';
        messageText += 'Approved users:\n';
        messageText += approvedUsers.map((userId: string) => `<@${userId}>`).join(',');
        messageText += '\n\nPlease contact them to run this migration.';

        return res.status(200).json({
          response_type: 'ephemeral',
          text: messageText,
        });
      }

      logger.info('[Migration] User authorized for /sync command', {
        userId: user_id,
      });
    }

    const client = new WebClient(token);
    const modalView = getSyncModal(channel_id);

    await client.views.open({
      trigger_id,
      view: modalView as any,
    });

    return res.status(200).send();
  } catch (error) {
    logger.error('[Migration] Error handling /sync command', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(200).json({
      response_type: 'ephemeral',
      text: 'Failed to open modal. Please try again.',
    });
  }
});

export default router;
