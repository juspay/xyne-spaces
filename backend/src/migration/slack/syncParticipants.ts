/**
 * /sync-participants command handler
 * Syncs participants for a given xyne-space channel
 * Usage: /sync-participants <xyneSpaceChannelId>
 */

import { Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import { logger } from '../../utils/logger';
import { postMessage } from './utils/postMessage';
import { addChannelParticipantsBeforeMigration } from './slackConversationService';
import { checkUserAuthorization } from './command';
import { ChannelRepository } from '../../database/repositories/channelRepository';

export async function handleSyncParticipantsCommand(req: Request, res: Response): Promise<Response> {
  try {
    const { channel_id, user_id, text } = req.body;

    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      logger.error('[Migration] SLACK_BOT_TOKEN is not set');
      return res.status(200).json({
        response_type: 'ephemeral',
        text: 'Slack integration is not configured.',
      });
    }

    const authResult = await checkUserAuthorization(user_id);
    if (!authResult.authorized) {
      logger.warn('[Migration] Unauthorized user attempted /sync-participants command', { user_id });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: authResult.message || 'You are not authorized to perform this action.',
      });
    }

    const xyneSpaceChannelId = (text || '').trim();
    if (!xyneSpaceChannelId) {
      return res.status(200).json({
        response_type: 'ephemeral',
        text: '❌ Usage: `/sync-participants <xyneSpaceChannelId>`',
      });
    }

    // Validate the xyne-space channel exists in the database
    const channelRepo = new ChannelRepository();
    const xyneChannel = await channelRepo.findById(xyneSpaceChannelId);
    if (!xyneChannel) {
      logger.warn('[Migration] /sync-participants invalid xyne-space channelId', {
        xyneSpaceChannelId,
        user_id,
      });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: `❌ Invalid xyne-space channel ID: \`${xyneSpaceChannelId}\`. Channel not found in database.`,
      });
    }

    const xyneSpaceChannelLink = `<https://spaces.xyne.juspay.net/chat/${xyneSpaceChannelId}|${xyneChannel.name}>`;

    // Verify the bot is a member of the channel — otherwise postMessage will silently
    // fail and the user gets no feedback after we ACK.
    const client = new WebClient(token);
    try {
      const channelInfo = await client.conversations.info({ channel: channel_id });
      if (!channelInfo.channel?.is_member) {
        return res.status(200).json({
          response_type: 'ephemeral',
          text: '❌ The bot is not a member of this channel. Please add the bot to this channel and try again.',
        });
      }
    } catch (error) {
      logger.warn('[Migration] /sync-participants bot cannot access channel', {
        channel_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: '❌ The bot is not a member of this channel. Please add the bot to this channel and try again.',
      });
    }

    // ACK the slash command immediately so Slack doesn't time out (3s limit)
    res.status(200).send();

    Promise.resolve()
      .then(async () => {
        const startedTs = await postMessage({
          channelId: channel_id,
          text: `🔄 <@${user_id}> :: Started Participant sync for xyne-space channel ${xyneSpaceChannelLink}...`,
        });

        try {
          await addChannelParticipantsBeforeMigration(channel_id, xyneSpaceChannelId);

          if (startedTs) {
            await client.chat.update({
              channel: channel_id,
              ts: startedTs,
              text: `✅ <@${user_id}> :: Participant sync completed for xyne-space channel ${xyneSpaceChannelLink}.`,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error('[Migration] /sync-participants failed', {
            channel_id,
            xyneSpaceChannelId,
            error: errorMessage,
          });

          if (startedTs) {
            await client.chat.update({
              channel: channel_id,
              ts: startedTs,
              text: `❌ Participant sync failed for xyne-space channel ${xyneSpaceChannelLink}:\n${errorMessage}`,
            });
          }
        }
      })
      .catch((error) => {
        logger.error('[Migration] Unexpected error in /sync-participants', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    return res;
  } catch (error) {
    logger.error('[Migration] Error handling /sync-participants command', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(200).json({
      response_type: 'ephemeral',
      text: 'Failed to start participant sync. Please try again.',
    });
  }
}
