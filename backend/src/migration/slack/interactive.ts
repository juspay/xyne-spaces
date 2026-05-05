/**
 * Slack Migration Interactive Handler
 * Handles modal submission
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { runMigration } from './slackConversationService';
import { runMigrationJiraffe } from './slackJiraffeService';
import { runSyncParticipants } from './syncParticipants';
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
      Promise.resolve()
        .then(() =>
          runMigration({
            syncDate,
            syncOptions,
            userId: user?.id,
            channelId,
            xyneSpaceChannelId,
          })
        )
        .catch((error) => {
          logger.error('[Migration] Error processing migration', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });

      return;
    }

    if (type === 'view_submission' && view?.callback_id === 'sync_jiraffe_modal') {
      const values = view.state.values || {};

      // Check if at least one field is filled
      const allTicketsChecked = values.all_titles_checkbox?.all_titles_checkbox_action?.selected_options?.length > 0;
      const syncDate = values.sync_date?.sync_date_picker?.selected_date;
      const xyneSpaceChannelId = values.xyne_space_channel_id?.xyne_space_channel_input?.value;

      // Validate: at least one of allTicketsChecked or syncDate must be present
      if (!allTicketsChecked && !syncDate) {
        // Return validation error - at least one field must be filled
        return res.status(200).json({
          response_action: 'errors',
          errors: {
            sync_date: 'Please select "All tickets" or provide a start date',
            all_titles_checkbox: 'Please select "All tickets" or provide a start date',
          },
        });
      }

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

      // Close modal immediately
      res.status(200).json({ response_action: 'clear' });

      // Run migration asynchronously
      Promise.resolve()
        .then(() =>
          runMigrationJiraffe({
            syncDate,
            allTicketsChecked,
            userId: user?.id,
            channelId,
            xyneSpaceChannelId,
          })
        )
        .catch((error) => {
          logger.error('[Migration] Error processing migration', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });

      return;
    }

    if (type === 'view_submission' && view?.callback_id === 'sync_participants_modal') {
      const values = view.state.values || {};
      const xyneSpaceChannelId = values.xyne_space_channel_id?.xyne_space_channel_input?.value;

      if (!xyneSpaceChannelId) {
        return res.status(200).json({
          response_action: 'errors',
          errors: { xyne_space_channel_id: 'Please enter a Xyne Space channel ID' },
        });
      }

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
        logger.error('[Migration] Channel ID not found for sync_participants_modal');
        return res.status(200).json({ response_action: 'clear' });
      }

      res.status(200).json({ response_action: 'clear' });

      Promise.resolve()
        .then(() => runSyncParticipants({ slackChannelId: channelId, xyneSpaceChannelId, userId: user?.id }))
        .catch((error) => {
          logger.error('[Migration] Error processing sync-participants', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
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
