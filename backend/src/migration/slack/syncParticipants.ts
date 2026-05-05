/**
 * /sync-participants command handler
 * Opens a modal to collect the Xyne Space channel ID, then syncs participants.
 */

import { Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import { logger } from '../../utils/logger';
import { postMessage } from './utils/postMessage';
import { addChannelParticipantsBeforeMigration } from './slackConversationService';
import { checkUserAuthorization } from './command';
import { getSyncParticipantsModal } from './utils/blockKit';
import { ChannelRepository } from '../../database/repositories/channelRepository';

export async function handleSyncParticipantsCommand(req: Request, res: Response): Promise<Response> {
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

    const authResult = await checkUserAuthorization(user_id);
    if (!authResult.authorized) {
      logger.warn('[Migration] Unauthorized user attempted /sync-participants command', { user_id });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: authResult.message || 'You are not authorized to perform this action.',
      });
    }

    const client = new WebClient(token);
    await client.views.open({
      trigger_id,
      view: getSyncParticipantsModal(channel_id) as any,
    });

    return res.status(200).send();
  } catch (error) {
    logger.error('[Migration] Error handling /sync-participants command', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(200).json({
      response_type: 'ephemeral',
      text: 'Failed to open modal. Please try again.',
    });
  }
}

export async function runSyncParticipants({
  slackChannelId,
  xyneSpaceChannelId,
  userId,
}: {
  slackChannelId: string;
  xyneSpaceChannelId: string;
  userId: string;
}): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN!;
  const client = new WebClient(token);

  const channelRepo = new ChannelRepository();
  const xyneChannel = await channelRepo.findById(xyneSpaceChannelId);
  if (!xyneChannel) {
    logger.warn('[Migration] /sync-participants invalid xyne-space channelId', { xyneSpaceChannelId, userId });
    await postMessage({
      channelId: slackChannelId,
      text: `❌ Invalid xyne-space channel ID: \`${xyneSpaceChannelId}\`. Channel not found in database.`,
    });
    return;
  }

  const xyneSpaceChannelLink = `<https://spaces.xyne.juspay.net/chat/${xyneSpaceChannelId}|${xyneChannel.name}>`;

  const startedTs = await postMessage({
    channelId: slackChannelId,
    text: `🔄 <@${userId}> :: Started Participant sync for xyne-space channel ${xyneSpaceChannelLink}...`,
  });

  try {
    await addChannelParticipantsBeforeMigration(slackChannelId, xyneSpaceChannelId, true, startedTs ?? undefined);

    if (startedTs) {
      await client.chat.update({
        channel: slackChannelId,
        ts: startedTs,
        text: `✅ <@${userId}> :: Participant sync completed for xyne-space channel ${xyneSpaceChannelLink}.`,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Migration] /sync-participants failed', { slackChannelId, xyneSpaceChannelId, error: errorMessage });

    if (startedTs) {
      await client.chat.update({
        channel: slackChannelId,
        ts: startedTs,
        text: `❌ Participant sync failed for xyne-space channel ${xyneSpaceChannelLink}:\n${errorMessage}`,
      });
    }
  }
}
