/**
 * Slack Migration Interactive Handler
 * Handles modal submission
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { runMigration } from './slackConversationService';
import { verifySlackRequest } from './middleware/verifySlackRequest';

const router = Router();

router.post('/interactive', verifySlackRequest, async (req: Request, res: Response) => {
  try {
    const payloadString = req.body.payload;

    if (!payloadString) {
      return res.status(200).json({ response_action: 'clear' });
    }

    const payload = typeof payloadString === 'string' ? JSON.parse(payloadString) : payloadString;
    const { type, view, user, container } = payload;

    if (type === 'view_submission' && view?.callback_id === 'sync_modal') {
      const values = view.state.values || {};

      // Get channel_id from private_metadata
      let channelId = container?.channel_id;
      if (!channelId && view.private_metadata) {
        try {
          const metadata = JSON.parse(view.private_metadata);
          channelId = metadata.channel_id;
        } catch (e) {
          logger.warn('[Migration] Failed to parse private_metadata', { error: e });
        }
      }

      if (!channelId) {
        logger.error('[Migration] Channel ID not found');
        return res.status(200).json({ response_action: 'clear' });
      }

      // Extract form data
      const syncDate = values.sync_date?.sync_date_picker?.selected_date;
      const xyneSpaceChannelId = values.xyne_space_channel_id?.xyne_space_channel_input?.value;
      const syncOptions = values.sync_options?.sync_checkboxes?.selected_options?.map(
        (opt: any) => opt.value
      );

      // Close modal immediately
      res.status(200).json({ response_action: 'clear' });

      // Run migration asynchronously
      setImmediate(async () => {
        try {
          await runMigration({
            syncDate,
            syncOptions,
            userId: user?.id,
            channelId,
            xyneSpaceChannelId,
          });
        } catch (error) {
          logger.error('[Migration] Error processing migration', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });

      return;
    }

    return res.status(200).json({ response_action: 'clear' });
  } catch (error) {
    logger.error('[Migration] Error handling modal submission', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(200).json({ response_action: 'clear' });
  }
});

export default router;
