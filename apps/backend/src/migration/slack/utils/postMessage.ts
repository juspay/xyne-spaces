/**
 * Slack Post Message Utility
 * Handles posting messages to channels, threads, and DMs
 */

import { WebClient } from '@slack/web-api';
import { logger } from '../../../utils/logger';

export interface PostMessageOptions {
  channelId?: string;
  userId?: string; // For DMs
  text?: string;
  blocks?: any[];
  threadTs?: string; // For thread replies
  botToken?: string; // Per-workspace bot token; falls back to config.slackBotToken
}

function getSlackClient(token?: string): WebClient | null {
  const resolvedToken = token || process.env.SLACK_BOT_TOKEN;
  if (!resolvedToken) {
    logger.warn('[Migration] No bot token available for postMessage');
    return null;
  }
  return new WebClient(resolvedToken);
}

async function openDMConversation(client: WebClient, userId: string): Promise<string | null> {
  try {
    const conversation = await client.conversations.open({
      users: userId,
    });
    return conversation.channel?.id || null;
  } catch (error) {
    logger.error('[Migration] Error opening DM conversation', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId,
    });
    return null;
  }
}

async function getTargetChannel(
  client: WebClient,
  channelId?: string,
  userId?: string
): Promise<string | null> {
  if (channelId) {
    return channelId;
  }

  if (userId) {
    return await openDMConversation(client, userId);
  }

  return null;
}

/**
 * Posts a message to Slack (channel, thread, or DM)
 */
export async function postMessage(options: PostMessageOptions): Promise<string | null> {
  const { channelId, userId, text, blocks, threadTs, botToken } = options;

  if (!channelId && !userId) {
    logger.warn('[Migration] Either channelId or userId is required');
    return null;
  }

  const client = getSlackClient(botToken);
  if (!client) {
    return null;
  }

  try {
    const targetChannel = await getTargetChannel(client, channelId, userId);
    if (!targetChannel) {
      logger.warn('[Migration] No target channel available');
      return null;
    }

    const result = await client.chat.postMessage({
      channel: targetChannel,
      text: text,
      blocks: blocks as any,
      thread_ts: threadTs,
    });

    if (result.ok && result.ts) {
      return result.ts;
    } else {
      logger.error('[Migration] Failed to post message to Slack', {
        channelId: targetChannel,
        userId,
        error: result.error,
      });
      return null;
    }
  } catch (error) {
    logger.error('[Migration] Error posting message to Slack', {
      error: error instanceof Error ? error.message : 'Unknown error',
      channelId,
      userId,
    });
    return null;
  }
}
