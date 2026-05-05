import { WebClient } from '@slack/web-api';
import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { fetchPinnedMessageTimestamps } from './utils/extractConversation';
import { postMessage } from './utils/postMessage';
import { checkUserAuthorization } from './command';
import { ExternalSourceRepository } from '../../database/repositories/externalSourceRepository';
import { ExternalMessageRepository } from '../../database/repositories/externalMessageRepository';
import { MessageRepository } from '../../database/repositories/messageRepository';
import { ConversationRepository } from '../../database/repositories/conversationRepository';

export async function handleSyncPinnedMessagesCommand(req: Request, res: Response): Promise<Response> {
  try {
    const { channel_id, user_id } = req.body;

    const authResult = await checkUserAuthorization(user_id);
    if (!authResult.authorized) {
      logger.warn('[Migration] Unauthorized user attempted /sync-pinned-messages command', { user_id });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: authResult.message || 'You are not authorized to perform this action.',
      });
    }

    res.status(200).json({ response_type: 'ephemeral', text: '🔄 Syncing pinned messages...' });

    Promise.resolve()
      .then(() => syncPinnedMessages({ slackChannelId: channel_id }))
      .catch((error) => {
        logger.error('[Migration] Error syncing pinned messages', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    return res;
  } catch (error) {
    logger.error('[Migration] Error handling /sync-pinned-messages command', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(200).json({
      response_type: 'ephemeral',
      text: 'Failed to sync pinned messages. Please try again.',
    });
  }
}

export async function syncPinnedMessages({
  slackChannelId,
}: {
  slackChannelId: string;
}): Promise<void> {
  const externalSourceRepo = new ExternalSourceRepository();
  const externalMessageRepo = new ExternalMessageRepository();
  const messageRepo = new MessageRepository();
  const conversationRepo = new ConversationRepository();

  const externalSource = await externalSourceRepo.findByName(`slackMigration-${slackChannelId}`);
  if (!externalSource) {
    await postMessage({ channelId: slackChannelId, text: '❌ This channel has not been migrated yet. Run `/sync` first.' });
    return;
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    logger.error('[SyncPins] SLACK_BOT_TOKEN is not set');
    await postMessage({ channelId: slackChannelId, text: '❌ Slack integration is not configured.' });
    return;
  }

  const client = new WebClient(token);
  const pinnedTs = await fetchPinnedMessageTimestamps(client, slackChannelId);

  if (pinnedTs.size === 0) {
    await postMessage({ channelId: slackChannelId, text: '✅ No pinned messages found in this channel.' });
    return;
  }

  let pinnedCount = 0;
  let skippedCount = 0;

  for (const ts of pinnedTs) {
    const externalMessage = await externalMessageRepo.findByExternalId(externalSource.id, ts);
    if (!externalMessage?.entityId) {
      logger.warn('[SyncPins] Pinned message not found in migration records', { ts, slackChannelId });
      skippedCount++;
      continue;
    }

    const message = await messageRepo.findById(externalMessage.entityId);
    if (!message) {
      logger.warn('[SyncPins] Message record not found', { entityId: externalMessage.entityId });
      skippedCount++;
      continue;
    }

    await conversationRepo.update(message.conversationId, { pinned: true });
    pinnedCount++;
  }

  logger.info('[SyncPins] Pin sync complete', { slackChannelId, pinnedCount, skippedCount });

  const skippedNote = skippedCount > 0 ? ` ${skippedCount} message(s) skipped (pinned after migration window).` : '';
  await postMessage({ channelId: slackChannelId, text: `✅ Pinned ${pinnedCount} conversation(s).${skippedNote}` });
}
