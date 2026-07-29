/**
 * Extract Channel Members Utility
 * Fetches all members of a Slack channel using conversations.members API
 */

import { WebClient } from '@slack/web-api';
import { logger } from '../../../utils/logger';

/**
 * Get Slack Web API client
 */
function getSlackClient(token?: string): WebClient {
  const resolvedToken = token || process.env.SLACK_BOT_TOKEN;
  if (!resolvedToken) {
    throw new Error('No bot token available for extractChannelMembers');
  }
  return new WebClient(resolvedToken);
}

/**
 * Retry helper for rate-limited API calls
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (error?.data?.error === 'rate_limited' || error?.status === 429) {
        const delay = initialDelay * Math.pow(2, attempt);
        const retryAfter = error?.data?.retry_after ? error.data.retry_after * 1000 : delay;

        logger.warn('[ExtractChannelMembers] Rate limited, retrying...', {
          attempt: attempt + 1,
          maxRetries,
          retryAfter,
        });

        await new Promise((resolve) => setTimeout(resolve, retryAfter));
        continue;
      }
      throw error;
    }
  }

  throw lastError!;
}

/**
 * Fetch all members of a Slack channel
 * Uses conversations.members API with pagination support
 */
export async function extractChannelMembers(channelId: string, botToken?: string): Promise<string[]> {
  const client = getSlackClient(botToken);
  const allMemberIds: string[] = [];
  let cursor: string | undefined = undefined;

  logger.info('[ExtractChannelMembers] Fetching channel members', { channelId });

  try {
    do {
      const response = await retryWithBackoff(async () => {
        return await client.conversations.members({
          channel: channelId,
          cursor,
          limit: 1000, // Max allowed by Slack API
        });
      });

      if (!response.ok) {
        throw new Error(
          `Slack API error: ${response.error || 'Unknown error'} (code: ${response.error})`
        );
      }

      if (response.members && Array.isArray(response.members)) {
        allMemberIds.push(...response.members);
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    logger.info('[ExtractChannelMembers] Successfully fetched channel members', {
      channelId,
      memberCount: allMemberIds.length,
      userIds: allMemberIds,
    });

    return allMemberIds;
  } catch (error) {
    logger.error('[ExtractChannelMembers] Failed to fetch channel members', {
      channelId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}
