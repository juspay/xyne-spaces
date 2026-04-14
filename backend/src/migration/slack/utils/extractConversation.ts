/**
 * Extract Channel History Utility
 * Fetches channel history using Slack conversations.history API
 * Includes thread replies for complete conversation extraction
 */

import {
  WebClient,
  ConversationsHistoryResponse,
  ConversationsRepliesResponse,
} from '@slack/web-api';
import { logger } from '../../../utils/logger';
import { config } from '../../../config/env';
import { fetchSlackUserInfo, resolveSlackMentions } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { UserRepository } from '../../../database/repositories/users';
import { SlackBlockKitParser } from '../../../integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ChannelHistoryOptions {
  channelId: string;
  oldest: string; // Date string (YYYY-MM-DD) or Unix timestamp
  latest?: string; // Optional end date/timestamp, defaults to now
  includeThreads?: boolean; // Fetch all thread replies (default: true)
  includeAttachments?: boolean; // Fetch all attachments (default: true)
  includeDeactivatedUsers?: boolean; // Fetch deactivated users (default: true)
  includeBotMessages?: boolean; // Include bot messages when allowedBots is empty (default: false)
}

export interface SlackFile {
  name: string;
  mimetype: string;
  url_private: string;
  size: number;
}

export interface SlackReply {
  content: string;
  externalThreadId: string;
  userEmail?: string;
  userName?: string;
  userId?: string;
  showInChannel?: boolean;
  isDeactivated?: boolean;
  files?: SlackFile[];
  botId?: string;  
  botUserId?: string;
  botName?: string;
}

export interface SlackMessage {
  content: string;
  externalId: string;
  userEmail?: string;
  userName?: string;
  userId?: string;
  isDeactivated?: boolean;
  replies?: SlackReply[];
  files?: SlackFile[];
  botId?: string;
  botUserId?: string;
  botName?: string;
}

export type UserInfoCache = Map<
  string,
  {
    userEmail?: string;
    userName?: string;
    userId?: string;
    isDeactivated?: boolean;
    isBot?: boolean;
  }
>;

// ============================================================================
// Constants
// ============================================================================

const SYSTEM_SUBTYPES = [
  'channel_join',
  'channel_leave',
  'channel_archive',
  'channel_unarchive',
  'channel_name',
  'channel_purpose',
  'channel_topic',
  'pinned_item',
  'unpinned_item',
  'bot_add',
  'bot_remove',
  'thread_broadcast',
  'reminder_add',
  'channel_posting_permissions',
];

const ALLOWED_SYSTEM_THREAD_SUBTYPES = ['thread_broadcast'];

// Rate limiting config for Slack users.info API (~50 req/min)
const USER_FETCH_BATCH_SIZE = 10;
const USER_FETCH_BATCH_DELAY_MS = 15000; // 15 seconds between batches
const USER_FETCH_ITEM_DELAY_MS = 200; // 200ms between individual requests

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert date string or timestamp to Unix timestamp
 */
function toUnixTimestamp(dateInput: string): string {
  if (/^\d+(\.\d+)?$/.test(dateInput)) {
    return dateInput;
  }

  const date = new Date(dateInput);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateInput}. Use YYYY-MM-DD or Unix timestamp.`);
  }

  return Math.floor(date.getTime() / 1000).toString();
}

/**
 * Get Slack Web API client
 */
function getSlackClient(): WebClient {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN environment variable is not set');
  }
  return new WebClient(token);
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

        logger.warn('[Migration] Rate limited, retrying...', {
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
 * Generic batch processor with delays
 */
async function processBatch<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  options: {
    batchSize: number;
    itemDelay: number;
    batchDelay: number;
    logPrefix: string;
  }
): Promise<void> {
  const { batchSize, itemDelay, batchDelay, logPrefix } = options;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);

    logger.info(`[Migration] ${logPrefix}`, {
      batch: `${batchNum}/${totalBatches}`,
      items: batch.length,
    });

    for (const item of batch) {
      await processor(item);
      if (itemDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, itemDelay));
      }
    }

    // Delay between batches (except for last batch)
    if (i + batchSize < items.length && batchDelay > 0) {
      logger.info(`[Migration] Waiting before next batch`, {
        delaySeconds: batchDelay / 1000,
      });
      await new Promise((resolve) => setTimeout(resolve, batchDelay));
    }
  }
}

/**
 * Check if message should be included in conversation
 * - Filters out system messages
 * - Includes human messages (non-bot)
 * - Includes bot messages only if:
 *     allowedBots is non-empty and bot name matches, OR
 *     allowedBots is empty AND includeBotMessages is true
 * @param allowedBots - Array of bot names (case-insensitive) to include (default: [])
 * @param includeBotMessages - When allowedBots is empty, include all (non-ignored) bot messages (default: false)
 */
function isHumanMessage(
  message: any,
  context: 'channel' | 'thread' = 'channel',
  allowedBots: string[] = [],
  includeBotMessages = false
): boolean {
  // Filter out system messages (with exceptions for threads)
  if (message.subtype && SYSTEM_SUBTYPES.includes(message.subtype)) {
    if (context === 'thread' && ALLOWED_SYSTEM_THREAD_SUBTYPES.includes(message.subtype)) {
      return true;
    }
    return false;
  }

  // If it's a bot message: filter by allowedBots name list, or by the includeBotMessages flag
  if (message.bot_id) {
    if (allowedBots.length > 0) {
      const botName = message.username?.toLowerCase() ||
                      message.app_name?.toLowerCase() ||
                      message.bot_profile?.name?.toLowerCase() ||
                      '';
      return allowedBots.some(allowed => botName.includes(allowed.toLowerCase()));
    }
    // When no allowedBots filter: skip if bot is in the env-level ignore list
    if (config.slackIgnoredBotIds.includes(message.bot_id)) {
      return false;
    }
    return includeBotMessages;
  }

  // Include all user messages (non-bot)
  return !!message.user;
}

/**
 * Transform raw Slack files to SlackFile[]
 */
function transformFiles(rawFiles: any[] | undefined, includeAttachments: boolean): SlackFile[] | undefined {
  if (!includeAttachments || !rawFiles?.length) return undefined;

  const validFiles = rawFiles
    .filter((f) => f.name && f.mimetype && f.url_private && f.size)
    .map((f) => ({
      name: f.name,
      mimetype: f.mimetype,
      url_private: f.url_private,
      size: f.size,
    }));

  return validFiles.length ? validFiles : undefined;
}

// ============================================================================
// User Info Management
// ============================================================================

/**
 * Get user info from cache, database, or fetch from Slack API
 * Caches both database lookups (userId) and API-fetched results to avoid unnecessary calls
 */
export async function getUserInfo(slackUID: string, cache: UserInfoCache): Promise<{
  userEmail?: string;
  userName?: string;
  userId?: string;
  isDeactivated?: boolean;
  isBot?: boolean;
}> {
  if (cache.has(slackUID)) {
    return cache.get(slackUID)!;
  }

  try {
    const userRepo = new UserRepository();
    const user = await userRepo.findByMetadataField('slackId', slackUID);
    
    if (user) {
      const result = {
        userId: user.id,
      };
      cache.set(slackUID, result);
      return result;
    }
  } catch (error) {
    logger.debug('[Migration] User not found in database by slackId, fetching from Slack API', {
      slackUID,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN environment variable is not set');
  }

  const userInfo = await retryWithBackoff(() => fetchSlackUserInfo(slackUID, token));

  if (!userInfo || !userInfo.profile?.email) {
    const result = {
      userEmail: userInfo?.profile?.email,
      userName: userInfo?.profile?.real_name,
      isDeactivated: userInfo?.deleted,
      isBot: userInfo?.is_bot,
    };
    cache.set(slackUID, result);
    return result;
  }

  if (userInfo.is_bot) {
    const result = { isBot: true };
    cache.set(slackUID, result);
    return result;
  }

  try {
    const userRepo = new UserRepository();
    const userByEmail = await userRepo.findByEmail(userInfo.profile.email);
    
    if (userByEmail) {
      await userRepo.upsertMetaDataField(userByEmail.id, 'slackId', slackUID);
      
      const result = {
        userId: userByEmail.id,
      };
      cache.set(slackUID, result);
      return result;
    }
  } catch (error) {
    logger.debug('[Migration] Error checking database by email or upserting metadata', {
      slackUID,
      email: userInfo.profile.email,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
  const result = {
    userEmail: userInfo.profile.email,
    userName: userInfo.profile.real_name,
    isDeactivated: userInfo.deleted,
    botId: userInfo.profile?.bot_id,
  };

  cache.set(slackUID, result);
  return result;
}

/**
 * Extract all unique user IDs from messages and threads
 */
function extractUniqueUserIds(rawMessages: any[], threadRepliesMap: Map<string, any[]>): string[] {
  const userIds = new Set<string>();

  for (const msg of rawMessages) {
    if (msg.user && !msg.bot_id) userIds.add(msg.user);
  }

  for (const replies of threadRepliesMap.values()) {
    for (const reply of replies) {
      if (reply.user && !reply.bot_id) userIds.add(reply.user);
    }
  }

  return Array.from(userIds);
}

/**
 * Pre-fetch all user info in controlled batches to avoid rate limits
 */
async function prefetchUserInfo(userIds: string[], cache: UserInfoCache): Promise<void> {
  const uncachedUserIds = userIds.filter((id) => id && !cache.has(id));

  if (uncachedUserIds.length === 0) {
    logger.info('[Migration] All user info already cached');
    return;
  }

  logger.info('[Migration] Pre-fetching user info', {
    totalUsers: uncachedUserIds.length,
  });

  await processBatch(
    uncachedUserIds,
    async (userId) => {
      await getUserInfo(userId, cache);
    },
    {
      batchSize: USER_FETCH_BATCH_SIZE,
      itemDelay: USER_FETCH_ITEM_DELAY_MS,
      batchDelay: USER_FETCH_BATCH_DELAY_MS,
      logPrefix: 'Fetching user batch',
    }
  );

  logger.info('[Migration] User info pre-fetch complete', {
    cachedUsers: cache.size,
  });
}

// ============================================================================
// Slack API Fetchers
// ============================================================================

/**
 * Fetch all thread replies for a message
 */
export async function fetchThreadReplies(
  client: WebClient,
  channelId: string,
  threadTs: string,
  allowedBots: string[] = [],
  includeBotMessages = false
): Promise<any[]> {
  const replies: any[] = [];
  let cursor: string | undefined;

  do {
    const result: ConversationsRepliesResponse = await retryWithBackoff(() =>
      client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 1000,
        cursor,
      })
    );

    if (!result.ok) {
      logger.error('[Migration] Failed to fetch thread replies', {
        channelId,
        threadTs,
        error: result.error,
      });
      break;
    }

    if (result.messages && result.messages.length > 0) {
      const humanReplies = result.messages.slice(1).filter((msg) => isHumanMessage(msg, 'thread', allowedBots, includeBotMessages));
      replies.push(...humanReplies);
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  return replies;
}

/**
 * Fetch all top-level messages from channel
 */
async function fetchChannelMessages(
  client: WebClient,
  channelId: string,
  oldestTimestamp: string,
  latestTimestamp: string,
  includeBotMessages = false
): Promise<any[]> {
  const messages: any[] = [];
  let cursor: string | undefined;

  do {
    const result: ConversationsHistoryResponse = await retryWithBackoff(() =>
      client.conversations.history({
        channel: channelId,
        oldest: oldestTimestamp,
        latest: latestTimestamp,
        limit: 1000,
        cursor,
        inclusive: true,
      })
    );

    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error || 'Unknown error'}`);
    }

    if (result.messages && result.messages.length > 0) {
      const humanMessages = result.messages.filter((msg) => isHumanMessage(msg, 'channel', [], includeBotMessages));
      messages.push(...humanMessages);

      logger.debug('[Migration] Fetched message batch', {
        batchSize: result.messages.length,
        humanCount: humanMessages.length,
        totalCount: messages.length,
      });
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  return messages;
}

/**
 * Fetch all thread replies for messages that have threads
 */
async function fetchAllThreadReplies(
  client: WebClient,
  channelId: string,
  rawMessages: any[],
  includeBotMessages = false
): Promise<Map<string, any[]>> {
  const threadRepliesMap = new Map<string, any[]>();
  const messagesWithThreads = rawMessages.filter((msg) => msg.reply_count && msg.reply_count > 0);

  if (messagesWithThreads.length === 0) {
    return threadRepliesMap;
  }

  logger.info('[Migration] Fetching thread replies', {
    totalThreads: messagesWithThreads.length,
  });

  for (const rawMessage of messagesWithThreads) {
    try {
      const threadReplies = await fetchThreadReplies(client, channelId, rawMessage.ts, [], includeBotMessages);

      if (threadReplies.length > 0) {
        threadRepliesMap.set(rawMessage.ts, threadReplies);
      }
    } catch (error) {
      logger.error('[Migration] Error fetching thread replies', {
        threadTs: rawMessage.ts,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info('[Migration] Completed fetching thread replies', {
    totalThreads: threadRepliesMap.size,
  });

  return threadRepliesMap;
}

// ============================================================================
// Message Transformation
// ============================================================================

const blockKitParser = new SlackBlockKitParser();

async function extractMessageContent(msg: any): Promise<string> {
  const token = process.env.SLACK_BOT_TOKEN || '';
  let resolvedBlocks = msg.blocks;
  if (msg.blocks?.length) {
    const resolved = await resolveSlackMentions(JSON.stringify(msg.blocks), token, true);
    resolvedBlocks = JSON.parse(resolved);
  }

  let resolvedAttachments = msg.attachments;
  if (msg.attachments?.length) {
    const resolved = await resolveSlackMentions(JSON.stringify(msg.attachments), token, true);
    resolvedAttachments = JSON.parse(resolved);
  }

  const resolvedText = !msg.blocks?.length && msg.text
    ? await resolveSlackMentions(msg.text, token)
    : undefined;
  const html = blockKitParser.parse({
    text: resolvedText,
    blocks: resolvedBlocks,
    attachments: resolvedAttachments,
  });

  return resolveSlackMentions(html, token);
}

export async function transformReply(
  reply: any,
  cache: UserInfoCache,
  includeAttachments: boolean,
  allowedBots: string[] = []
): Promise<SlackReply> {
  const isBot = !!reply.bot_id;
  const userInfo = !isBot && reply.user ? await getUserInfo(reply.user, cache) : {};
  const botName = isBot
    ? (reply.username || reply.app_name || reply.bot_profile?.name)
    : undefined;

  const htmlContent = await extractMessageContent(reply);

  // Check if this is a bot message that matches allowedBots
  let botEmail: string | undefined;
  if (reply.bot_id && allowedBots.length > 0) {
    const botNameLower = reply.username?.toLowerCase() ||
                    reply.app_name?.toLowerCase() ||
                    reply.bot_profile?.name?.toLowerCase() ||
                    '';
    // Case-insensitive matching: check if bot name includes any allowed bot name
    const matchesAllowed = allowedBots.some(allowed => {
      const allowedLower = allowed.toLowerCase();
      return botNameLower.includes(allowedLower) || allowedLower.includes(botNameLower);
    });

    // If bot matches and userEmail is missing, create bot email (userName can exist)
    if (matchesAllowed && !userInfo?.userEmail && botNameLower) {
      const emailUsername = reply.username || reply.app_name || reply.bot_profile?.name || botNameLower;
      botEmail = `${emailUsername.toLowerCase().replace(/[^a-z0-9]/g, '')}@xyne.bot.in`;
    }
  }

  return {
    content: htmlContent,
    externalThreadId: reply.ts,
    ...(userInfo?.userEmail && { userEmail: userInfo.userEmail }),
    ...(botEmail && { userEmail: botEmail }),
    ...(userInfo?.userName && { userName: userInfo.userName }),
    ...(userInfo?.userId && { userId: userInfo.userId }),
    ...(userInfo?.isDeactivated === true && { isDeactivated: true }),
    showInChannel: reply.subtype === 'thread_broadcast',
    files: transformFiles(reply.files, includeAttachments),
    ...(reply.bot_id && { botId: reply.bot_id }),
    ...(reply.bot_id && reply.user && { botUserId: reply.user }),
    ...(botName && { botName }),
  };
}

/**
 * Transform raw Slack message to SlackMessage
 */
async function transformMessage(
  rawMessage: any,
  threadReplies: any[] | undefined,
  cache: UserInfoCache,
  includeAttachments: boolean,
  includeDeactivatedUsers: boolean
): Promise<SlackMessage> {
  const isBot = !!rawMessage.bot_id;
  const userInfo = !isBot && rawMessage.user ? await getUserInfo(rawMessage.user, cache) : {};
  const botName = isBot
    ? (rawMessage.username || rawMessage.app_name || rawMessage.bot_profile?.name)
    : undefined;

  // Transform thread replies
  let replies: SlackReply[] | undefined;
  if (threadReplies?.length) {
    replies = await Promise.all(
      threadReplies.map((reply) => transformReply(reply, cache, includeAttachments))
    );

    // Filter replies
    if (!includeDeactivatedUsers) {
      replies = replies.filter((r) => !r.isDeactivated);
    }
    if (!includeAttachments) {
      replies = replies.filter((r) => r.content?.trim().length > 0);
    }
    if (replies.length === 0) {
      replies = undefined;
    }
  }

  // Transform message content
  const htmlContent = await extractMessageContent(rawMessage);

  return {
    content: htmlContent,
    externalId: rawMessage.ts,
    ...(userInfo?.userEmail && { userEmail: userInfo.userEmail }),
    ...(userInfo?.userName && { userName: userInfo.userName }),
    ...(userInfo?.userId && { userId: userInfo.userId }),
    ...(userInfo?.isDeactivated === true && { isDeactivated: true }),
    replies,
    files: transformFiles(rawMessage.files, includeAttachments),
    ...(rawMessage.bot_id && { botId: rawMessage.bot_id }),
    ...(rawMessage.bot_id && rawMessage.user && { botUserId: rawMessage.user }),
    ...(botName && { botName }),
  };
}

// ============================================================================
// Main Export Function
// ============================================================================

/**
 * Extract all channel history from specified date range
 */
export async function extractChannelHistory(
  options: ChannelHistoryOptions,
  postingUserIds?: Set<string>
): Promise<SlackMessage[]> {
  const {
    channelId,
    oldest,
    latest,
    includeThreads = false,
    includeAttachments = true,
    includeDeactivatedUsers = true,
    includeBotMessages = false,
  } = options;

  // Validate inputs
  if (!channelId?.trim()) {
    throw new Error('channelId is required');
  }

  const oldestTimestamp = toUnixTimestamp(oldest);
  const latestTimestamp = latest ? toUnixTimestamp(latest) : Math.floor(Date.now() / 1000).toString();

  if (parseFloat(oldestTimestamp) >= parseFloat(latestTimestamp)) {
    throw new Error('oldest date must be before latest date');
  }

  logger.info('[Migration] Starting channel history extraction', {
    channelId,
    oldest: oldestTimestamp,
    latest: latestTimestamp,
    includeThreads,
    includeAttachments,
    includeDeactivatedUsers,
    includeBotMessages,
  });

  const client = getSlackClient();
  const userCache: UserInfoCache = new Map();

  // Step 1: Fetch all top-level messages
  const rawMessages = await fetchChannelMessages(client, channelId, oldestTimestamp, latestTimestamp, includeBotMessages);
  logger.info('[Migration] Fetched top-level messages', {
    totalMessages: rawMessages.length,
  });

  // Step 2: Fetch thread replies (if needed)
  const threadRepliesMap = includeThreads
    ? await fetchAllThreadReplies(client, channelId, rawMessages, includeBotMessages)
    : new Map<string, any[]>();

  // Step 3: Pre-fetch all user info
  const allUserIds = extractUniqueUserIds(rawMessages, threadRepliesMap);
  logger.info('[Migration] Extracted unique users', {
    totalUniqueUsers: allUserIds.length,
  });
  await prefetchUserInfo(allUserIds, userCache);

  if (postingUserIds) {
    for (const userId of allUserIds) {
      if (userId) {
        postingUserIds.add(userId);
      }
    }
  }

  // Step 4: Transform all messages
  logger.info('[Migration] Transforming messages');
  let messages = await Promise.all(
    rawMessages.map((rawMessage) =>
      transformMessage(
        rawMessage,
        threadRepliesMap.get(rawMessage.ts),
        userCache,
        includeAttachments,
        includeDeactivatedUsers
      )
    )
  );

  // Step 5: Apply filters
  if (!includeDeactivatedUsers) {
    messages = messages.filter((msg) => !msg.isDeactivated);
  }
  if (!includeAttachments) {
    messages = messages.filter((msg) => msg.content?.trim().length > 0);
  }

  logger.info('[Migration] Channel history extraction complete', {
    channelId,
    totalMessages: messages.length,
    uniqueUsers: userCache.size,
  });

  return messages;
}
