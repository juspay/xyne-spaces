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
import { getBotConfigByTeamId, getBotConfigByWorkspaceId } from './slackMigrationBotConfig';

export async function handleSyncParticipantsCommand(req: Request, res: Response): Promise<Response> {
  try {
    const { trigger_id, channel_id, user_id, team_id } = req.body;

    const token = getBotConfigByTeamId(team_id).slackBotToken;
    if (!token) {
      logger.error('[Migration] slackBotToken is not set for team', { team_id });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: 'Slack integration is not configured.',
      });
    }

    const authResult = await checkUserAuthorization(user_id, team_id);
    if (!authResult.authorized) {
      logger.warn('[Migration] Unauthorized user attempted /sync-participants command', { user_id, team_id });
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
  teamId,
}: {
  slackChannelId: string;
  xyneSpaceChannelId: string;
  userId: string;
  teamId?: string;
}): Promise<void> {
  const channelRepo = new ChannelRepository();
  const xyneChannel = await channelRepo.findById(xyneSpaceChannelId);

  // Use a preliminary logChannelId before workspaceId is resolved
  const preliminaryLogChannelId = slackChannelId;

  if (!xyneChannel) {
    logger.warn('[Migration] /sync-participants invalid xyne-space channelId', { xyneSpaceChannelId, userId });
    // Resolve botToken from teamId so the error goes to the right workspace bot
    const earlyBotToken = teamId ? getBotConfigByTeamId(teamId).slackBotToken : undefined;
    await postMessage({
      channelId: preliminaryLogChannelId,
      text: `❌ Invalid xyne-space channel ID: \`${xyneSpaceChannelId}\`. Channel not found in database.`,
      botToken: earlyBotToken,
    });
    return;
  }

  const workspaceId = xyneChannel.workspaceId;
  const wsConfig = getBotConfigByWorkspaceId(workspaceId);
  const token = wsConfig.slackBotToken;
  const client = new WebClient(token);
  const logChannelId = wsConfig.slackMigrationLogChannelId || slackChannelId;
  const xyneSpaceChannelLink = `<https://spaces.xyne.juspay.net/${workspaceId}/chat/dir/${xyneSpaceChannelId}|${xyneChannel.name}>`;
  const startedTs = await postMessage({
    channelId: logChannelId,
    text: `🔄 <@${userId}> :: Started Participant sync for xyne-space channel ${xyneSpaceChannelLink}...`,
    botToken: token,
  });

  try {
    await addChannelParticipantsBeforeMigration(slackChannelId, xyneSpaceChannelId, true, startedTs ?? undefined, logChannelId);

    if (startedTs) {
      await client.chat.update({
        channel: logChannelId,
        ts: startedTs,
        text: `✅ <@${userId}> :: Participant sync completed for xyne-space channel ${xyneSpaceChannelLink}.`,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Migration] /sync-participants failed', { slackChannelId, xyneSpaceChannelId, error: errorMessage });

    if (startedTs) {
      await client.chat.update({
        channel: logChannelId,
        ts: startedTs,
        text: `❌ Participant sync failed for xyne-space channel ${xyneSpaceChannelLink}:\n${errorMessage}`,
      });
    }
  }
}
