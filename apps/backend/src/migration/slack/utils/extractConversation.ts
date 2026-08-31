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
import type { BotsInfoResponse } from '@slack/web-api/dist/types/response/BotsInfoResponse';
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
  workspaceId: string; // Target workspace — used to scope user lookups/creation
  oldest: string; // Date string (YYYY-MM-DD) or Unix timestamp
  latest?: string; // Optional end date/timestamp, defaults to now
  includeThreads?: boolean; // Fetch all thread replies (default: true)
  includeAttachments?: boolean; // Fetch all attachments (default: true)
  includeDeactivatedUsers?: boolean; // Fetch deactivated users (default: true)
  includeBotMessages?: boolean; // Include bot messages when allowedBots is empty (default: false)
  /** Optional user token (xoxp-...) to use instead of the bot token. Required for DMs. */
  token?: string;
}

export interface SlackFile {
  name: string;
  mimetype: string;
  url_private: string;
  size: number;
  prefetchedStoragePath?: string;
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
  isPinned?: boolean;
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
  isPinned?: boolean;
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
// Bot name cache & helper
// ============================================================================

/** Module-level cache: Slack botId (B-prefixed) → resolved display name */
const botNameCache = new Map<string, string>();

/**
 * Fetch the display name of a Slack bot via the `bots.info` API.
 * Falls back silently and returns undefined on error.
 */
async function fetchSlackBotName(botId: string, botToken: string): Promise<string | undefined> {
  const cached = botNameCache.get(botId);
  if (cached !== undefined) return cached;

  try {
    const client = new WebClient(botToken);
    const result: BotsInfoResponse = await client.bots.info({ bot: botId });
    const name = result.bot?.name;
    if (name) {
      botNameCache.set(botId, name);
      return name;
    }
  } catch (err) {
    logger.warn('[fetchSlackBotName] Failed to fetch bot info from Slack', { botId, err });
  }
  return undefined;
}

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
 * Fetch pinned message timestamps from a Slack channel
 * Slack pins.list API returns all pinned items for a channel
 * We extract the message timestamps to identify which messages are pinned
 */
export async function fetchPinnedMessageTimestamps(
  client: WebClient,
  channelId: string
): Promise<Set<string>> {
  const pinnedTs = new Set<string>();

  try {
    const result = await retryWithBackoff(() =>
      client.pins.list({ channel: channelId })
    );

    if (!result.ok) {
      logger.error('[Migration] Failed to fetch pinned messages', {
        channelId,
        error: result.error,
      });
      return pinnedTs;
    }

    // Extract timestamps from pinned message items
    for (const item of result.items || []) {
      const itemAny = item as { type: string; message?: { ts: string } };
      if (item.type === 'message' && itemAny.message?.ts) {
        pinnedTs.add(itemAny.message.ts);
      }
    }

    logger.info('[Migration] Fetched pinned messages', {
      channelId,
      pinnedCount: pinnedTs.size,
    });

    return pinnedTs;
  } catch (error) {
    logger.error('[Migration] Unexpected error fetching pins', {
      channelId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return pinnedTs;
  }
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
export function isHumanMessage(
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
 * Collect every raw file carried by a Slack message: top-level `msg.files`
 * plus files nested inside `msg.attachments[]` (forwarded/shared messages).
 * De-duplicated by Slack file id so a file referenced in both places is kept once.
 */
export function collectRawFiles(msg: any): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  const push = (f: any) => {
    if (!f) return;
    const key = f.id || f.url_private || f.permalink;
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(f);
  };

  if (Array.isArray(msg?.files)) msg.files.forEach(push);
  if (Array.isArray(msg?.attachments)) {
    for (const att of msg.attachments) {
      if (Array.isArray(att?.files)) att.files.forEach(push);
    }
  }
  return out;
}

/**
 * Transform raw Slack files (incl. files nested in attachments) to SlackFile[]
 */
function transformFiles(msg: any, includeAttachments: boolean): SlackFile[] | undefined {
  if (!includeAttachments) return undefined;

  const rawFiles = collectRawFiles(msg);
  if (!rawFiles.length) return undefined;

  const validFiles = rawFiles
    .filter((f) => f.name && f.mimetype && f.url_private && f.size)
    .map((f) => ({
      name: f.name,
      mimetype: f.mimetype,
      url_private: f.url_private,
      size: f.size,
      // Preserve the collector's storage annotation so ingestion can attach offline.
      ...(f.prefetchedStoragePath ? { prefetchedStoragePath: f.prefetchedStoragePath as string } : {}),
    }));

  return validFiles.length ? validFiles : undefined;
}

/**
 * Pick the attachments worth rendering for a *human* message: forwarded/shared
 * messages, Slack-message unfurls, or attachments that carry their own content
 * (files / message_blocks / text). Skips empty auto link-unfurls to avoid noise.
 * Normalizes Slack's `message_blocks` (forwarded rich content) into the `blocks`
 * field the block-kit parser already understands.
 */
function extractRenderableAttachments(msg: any): any[] | undefined {
  const attachments: any[] = Array.isArray(msg?.attachments) ? msg.attachments : [];
  if (!attachments.length) return undefined;

  // Only forwarded/shared Slack messages and attachments carrying their own
  // files or rich content (incl. Block Kit `blocks` like tables) — NOT generic
  // web link-unfurls (preview cards of pasted URLs), which use legacy fields
  // (text/title/image_url) rather than `blocks` and would just be noise.
  const renderable = attachments
    .filter(
      (att) =>
        att?.is_share ||
        att?.is_msg_unfurl ||
        att?.files?.length ||
        att?.message_blocks?.length ||
        att?.blocks?.length,
    )
    .map((att) => {
      // Lift forwarded rich content (message_blocks[].message.blocks) into `blocks`
      // so the existing parser renders it. Only when `blocks` isn't already set.
      if (!att.blocks?.length && Array.isArray(att.message_blocks) && att.message_blocks.length) {
        const lifted = att.message_blocks
          .flatMap((mb: any) => mb?.message?.blocks ?? [])
          .filter(Boolean);
        if (lifted.length) return { ...att, blocks: lifted };
      }
      return att;
    });

  return renderable.length ? renderable : undefined;
}

// ============================================================================
// User Info Management
// ============================================================================

// Deduplication map for in-flight getUserInfo requests by (workspaceId, slackUID, botToken)
// Prevents thundering herd when the same user appears in many messages being processed concurrently
const inflightUserInfoRequests = new Map<string, Promise<{
  userEmail?: string;
  userName?: string;
  userId?: string;
  isDeactivated?: boolean;
  isBot?: boolean;
}>>();

function inflightUserInfoKey(slackUID: string, workspaceId: string, botToken?: string): string {
  return `${workspaceId}:${slackUID}:${botToken || ''}`;
}

/**
 * Get user info from cache, database, or fetch from Slack API
 * Caches both database lookups (userId) and API-fetched results to avoid unnecessary calls
 * Deduplicates concurrent in-flight requests for the same slackUID to prevent thundering herd
 * against the Slack API rate limits.
 */
export async function getUserInfo(slackUID: string, cache: UserInfoCache, workspaceId: string, botToken?: string): Promise<{
  userEmail?: string;
  userName?: string;
  userId?: string;
  isDeactivated?: boolean;
  isBot?: boolean;
}> {
  if (cache.has(slackUID)) {
    const cached = cache.get(slackUID)!;
    logger.info('[getUserInfo] Cache hit', { slackUID, cached });
    return cached;
  }

  // Deduplicate in-flight requests for the same user
  const inflightKey = inflightUserInfoKey(slackUID, workspaceId, botToken);
  const existing = inflightUserInfoRequests.get(inflightKey);
  if (existing) {
    logger.info('[getUserInfo] Reusing in-flight request', { slackUID, workspaceId });
    return existing;
  }

  const promise = getUserInfoInner(slackUID, cache, workspaceId, botToken);
  inflightUserInfoRequests.set(inflightKey, promise);

  try {
    return await promise;
  } finally {
    inflightUserInfoRequests.delete(inflightKey);
  }
}

async function getUserInfoInner(slackUID: string, cache: UserInfoCache, workspaceId: string, botToken?: string): Promise<{
  userEmail?: string;
  userName?: string;
  userId?: string;
  isDeactivated?: boolean;
  isBot?: boolean;
}> {
  // Double-check cache in case it was populated while we were waiting on the inflight lock
  if (cache.has(slackUID)) {
    const cached = cache.get(slackUID)!;
    logger.info('[getUserInfo] Cache hit (after inflight dedup)', { slackUID, cached });
    return cached;
  }

  try {
    const userRepo = new UserRepository();
    const userInWorkspace = await userRepo.findByMetadataField('slackId', slackUID, workspaceId);

    if (userInWorkspace) {
      const result = {
        userId: userInWorkspace.id,
        userEmail: userInWorkspace.email,
        userName: userInWorkspace.name,
      };
      logger.info('[getUserInfo] Returning user in target workspace', { slackUID, workspaceId, userId: userInWorkspace.id });
      cache.set(slackUID, result);
      return result;
    }
  } catch (error) {
    logger.debug('[Migration] User not found in database by slackId, fetching from Slack API', {
      slackUID,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const token = botToken || process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('No bot token available for user lookup');
  }

  const userInfo = await retryWithBackoff(() => fetchSlackUserInfo(slackUID, token));
  logger.info('[extractUserFromSlackUID] fetchSlackUserInfo returned', {
    slackUID,
    hasUserInfo: !!userInfo,
    userId: userInfo?.id,
    isBot: userInfo?.is_bot,
    deleted: userInfo?.deleted,
    hasProfile: !!userInfo?.profile,
    hasEmail: !!userInfo?.profile?.email,
  });

  if (!userInfo) {
    logger.warn('[extractUserFromSlackUID] User not found in Slack', { slackUID });
    cache.set(slackUID, { isDeactivated: undefined, isBot: undefined });
    return cache.get(slackUID)!;
  }

  if (userInfo.is_bot) {
    const result = { isBot: true };
    cache.set(slackUID, result);
    return result;
  }

  // User found but missing email — generate synthetic email for migration
  if (!userInfo.profile?.email) {
    const syntheticEmail = `${slackUID}@cross-platform.in`;
    const name = userInfo.profile?.real_name || userInfo.profile?.display_name || slackUID;

    logger.info('[extractUserFromSlackUID] User found but missing email, using synthetic email', {
      slackUID,
      syntheticEmail,
      realName: userInfo.profile?.real_name,
      displayName: userInfo.profile?.display_name,
    });

    const result = {
      userEmail: syntheticEmail,
      userName: name,
      isDeactivated: userInfo.deleted,
      isBot: false,
    };
    cache.set(slackUID, result);
    return result;
  }

  try {
    const userRepo = new UserRepository();
    const emailLower = userInfo.profile.email.toLowerCase();
    // Use the caller-supplied workspaceId (from the target channel) for exact-workspace lookups.
    const userByEmail = await userRepo.findByEmailCaseInsensitive(emailLower, workspaceId);

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
async function prefetchUserInfo(userIds: string[], cache: UserInfoCache, workspaceId: string, botToken?: string): Promise<void> {
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
      await getUserInfo(userId, cache, workspaceId, botToken);
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
    ).catch((err) => {
      logger.error('[Migration] conversations.history failed', {
        channelId,
        error: err?.data?.error || err?.message || err,
        needed_scope: err?.data?.needed,
        provided_scopes: err?.data?.provided,
      });
      throw err;
    });

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


async function deepResolveMentions<T>(obj: T, token: string, workspaceId?: string): Promise<T> {
  if (typeof obj === 'string') {
    return (await resolveSlackMentions(obj, token, false, workspaceId)) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return (await Promise.all(obj.map((item) => deepResolveMentions(item, token, workspaceId)))) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = await deepResolveMentions(value, token, workspaceId);
    }
    return result as T;
  }
  return obj;
}

// Display-name cache for huddle participants, keyed by Slack UID. Slack profile
// names rarely change, so caching avoids re-fetching the same user across huddles.
const huddleParticipantNameCache = new Map<string, string | null>();

/**
 * Resolve a single participant's Slack DISPLAY name (what Slack itself shows in
 * a huddle summary). Uses the Slack profile directly rather than the DB record —
 * the DB stores a handle (e.g. "siraj.shaik") and email-matched users carry no
 * name at all, both of which would misrender or silently drop the participant.
 */
async function resolveHuddleParticipantName(uid: string, botToken?: string): Promise<string | null> {
  if (huddleParticipantNameCache.has(uid)) {
    return huddleParticipantNameCache.get(uid)!;
  }

  const token = botToken || process.env.SLACK_BOT_TOKEN || '';
  let name: string | null = null;
  try {
    const info = await fetchSlackUserInfo(uid, token);
    // Prefer display_name (Slack shows this first), then real_name.
    name = info?.profile?.display_name || info?.profile?.real_name || null;
  } catch {
    name = null;
  }

  huddleParticipantNameCache.set(uid, name);
  return name;
}

/**
 * Resolve a huddle `room`'s participant Slack UIDs to display names so the
 * rendered summary reads like Slack ("A, B and C were in the huddle for 1m").
 * Falls back to the raw room (parser then shows a participant count) when no
 * name can be resolved.
 */
async function resolveHuddleRoom(room: any, botToken?: string): Promise<any> {
  const uids: string[] = room.participant_history?.length
    ? room.participant_history
    : room.participants ?? [];

  if (uids.length === 0) {
    return room;
  }

  const names = await Promise.all(uids.map((uid) => resolveHuddleParticipantName(uid, botToken)));

  const participant_names = names.filter((n): n is string => !!n);
  return participant_names.length ? { ...room, participant_names } : room;
}

async function extractMessageContent(msg: any, isBotContext: boolean = false, botToken?: string, workspaceId?: string): Promise<string> {
  const token = botToken || process.env.SLACK_BOT_TOKEN || '';

  if (!isBotContext) {
    // Normal (human) messages: text plus any forwarded/shared attachments.
    // Plain messages carry no attachments, so this is a no-op for them; forwarded
    // messages render the original author/body/files/permalink as a quote block.
    const resolvedText = msg.text
      ? await resolveSlackMentions(msg.text, token, false, workspaceId)
      : '';

    const renderableAttachments = extractRenderableAttachments(msg);
    const resolvedAttachments = renderableAttachments
      ? await deepResolveMentions(renderableAttachments, token, workspaceId)
      : undefined;

    // Huddle / call start messages (subtype `huddle_thread`) carry an empty
    // `text`; their content lives in the `room` object. Pass it through so the
    // parent renders a real summary — otherwise it's empty and gets filtered
    // out, taking its thread replies with it.
    const isHuddle = msg.subtype === 'huddle_thread' || !!msg.room?.call_family;
    const room = isHuddle && msg.room
      ? await resolveHuddleRoom(msg.room, botToken)
      : undefined;

    return blockKitParser.parse({
      text: resolvedText,
      attachments: resolvedAttachments,
      ...(isHuddle && { subtype: msg.subtype, room }),
    });
  }

  // Bot context: blocks primary, text fallback, attachments always resolved
  const resolvedBlocks = msg.blocks?.length
    ? await deepResolveMentions(msg.blocks, token, workspaceId)
    : undefined;

  const resolvedText = !resolvedBlocks && msg.text
    ? await resolveSlackMentions(msg.text, token, false, workspaceId)
    : undefined;

  const resolvedAttachments = msg.attachments?.length
    ? await deepResolveMentions(msg.attachments, token, workspaceId)
    : undefined;

  return blockKitParser.parse({
    text: resolvedText,
    blocks: resolvedBlocks,
    attachments: resolvedAttachments,
  });
}

export async function transformReply(
  reply: any,
  cache: UserInfoCache,
  includeAttachments: boolean,
  allowedBots: string[] = [],
  includeBotMessages: boolean = false,
  pinnedMessageTs: Set<string> | undefined,
  workspaceId: string,
  botToken?: string,
): Promise<SlackReply> {
  // Fetch userInfo for any message that has a user field — needed to detect
  // Slack bot-users (is_bot=true) that post without a bot_id on the message.
  const userInfo = reply.user ? await getUserInfo(reply.user, cache, workspaceId, botToken) : {};
  // isBot: explicit bot_id on the message, OR the user account itself is a bot
  const isBot = !!reply.bot_id || userInfo?.isBot === true;
  // effectiveBotId: prefer explicit bot_id; fall back to Slack UID for bot-users
  const effectiveBotId = reply.bot_id || (userInfo?.isBot ? reply.user : undefined);
  const botName = isBot
    ? (reply.username || reply.app_name || reply.bot_profile?.name
       || userInfo?.userName
       || (reply.bot_id && botToken ? await fetchSlackBotName(reply.bot_id, botToken) : undefined))
    : undefined;

  const isBotContext = !!reply.bot_id && (includeBotMessages || allowedBots.length > 0);
  const htmlContent = await extractMessageContent(reply, isBotContext, botToken, workspaceId);

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
    // Only include human-user fields when the sender is not a bot
    ...(!isBot && userInfo?.userEmail && { userEmail: userInfo.userEmail }),
    ...(botEmail && { userEmail: botEmail }),
    ...(!isBot && userInfo?.userName && { userName: userInfo.userName }),
    ...(!isBot && userInfo?.userId && { userId: userInfo.userId }),
    ...(!isBot && userInfo?.isDeactivated === true && { isDeactivated: true }),
    isPinned: pinnedMessageTs?.has(reply.ts),
    showInChannel: reply.subtype === 'thread_broadcast',
    files: transformFiles(reply, includeAttachments),
    ...(effectiveBotId && { botId: effectiveBotId }),
    // botUserId only for explicit bot_id messages (links the bot app to its Slack UID)
    ...(reply.bot_id && reply.user && { botUserId: reply.user }),
    ...(botName && { botName }),
  };
}

/**
 * Transform raw Slack message to SlackMessage
 */
export async function transformMessage(
  rawMessage: any,
  threadReplies: any[] | undefined,
  cache: UserInfoCache,
  includeAttachments: boolean,
  includeDeactivatedUsers: boolean,
  includeBotMessages: boolean = false,
  pinnedMessageTs: Set<string> | undefined,
  workspaceId: string,
  botToken?: string,
): Promise<SlackMessage> {
  // Fetch userInfo for any message that has a user field — needed to detect
  // Slack bot-users (is_bot=true) that post without a bot_id on the message.
  const userInfo = rawMessage.user ? await getUserInfo(rawMessage.user, cache, workspaceId, botToken) : {};
  // isBot: explicit bot_id on the message, OR the user account itself is a bot
  const isBot = !!rawMessage.bot_id || userInfo?.isBot === true;
  // effectiveBotId: prefer explicit bot_id; fall back to Slack UID for bot-users
  const effectiveBotId = rawMessage.bot_id || (userInfo?.isBot ? rawMessage.user : undefined);
  const botName = isBot
    ? (rawMessage.username || rawMessage.app_name || rawMessage.bot_profile?.name
       || userInfo?.userName
       || (rawMessage.bot_id && botToken ? await fetchSlackBotName(rawMessage.bot_id, botToken) : undefined))
    : undefined;

  // Transform thread replies
  let replies: SlackReply[] | undefined;
  if (threadReplies?.length) {
    replies = await Promise.all(
      threadReplies.map((reply) => transformReply(reply, cache, includeAttachments, [], includeBotMessages, pinnedMessageTs, workspaceId, botToken))
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
  const isBotContext = !!rawMessage.bot_id && includeBotMessages;
  const htmlContent = await extractMessageContent(rawMessage, isBotContext, botToken, workspaceId);

  return {
    content: htmlContent,
    externalId: rawMessage.ts,
    // Only include human-user fields when the sender is not a bot
    ...(!isBot && userInfo?.userEmail && { userEmail: userInfo.userEmail }),
    ...(!isBot && userInfo?.userName && { userName: userInfo.userName }),
    ...(!isBot && userInfo?.userId && { userId: userInfo.userId }),
    ...(!isBot && userInfo?.isDeactivated === true && { isDeactivated: true }),
    isPinned: pinnedMessageTs?.has(rawMessage.ts),
    replies,
    files: transformFiles(rawMessage, includeAttachments),
    ...(effectiveBotId && { botId: effectiveBotId }),
    // botUserId only for explicit bot_id messages (links the bot app to its Slack UID)
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
    workspaceId,
    oldest,
    latest,
    includeThreads = false,
    includeAttachments = true,
    includeDeactivatedUsers = true,
    includeBotMessages = false,
    token: overrideToken,
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

  const client = overrideToken ? new WebClient(overrideToken) : getSlackClient();
  const userCache: UserInfoCache = new Map();
  // Use the same client (bot or user token) to fetch pins inline
  const pinnedMessageTs = await fetchPinnedMessageTimestamps(client, channelId);

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
  await prefetchUserInfo(allUserIds, userCache, workspaceId, overrideToken);

  if (postingUserIds) {
    for (const userId of allUserIds) {
      if (userId) {
        postingUserIds.add(userId);
      }
    }
  }

  // Step 4: Transform all messages sequentially to prevent concurrent resolveApiGroup
  // calls from racing to create the same user/group records (unique constraint violations).
  logger.info('[Migration] Transforming messages');
  let messages: SlackMessage[] = [];
  for (const rawMessage of rawMessages) {
    messages.push(await transformMessage(
      rawMessage,
      threadRepliesMap.get(rawMessage.ts),
      userCache,
      includeAttachments,
      includeDeactivatedUsers,
      includeBotMessages,
      pinnedMessageTs,
      workspaceId,
      overrideToken,
    ));
  }

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

// ============================================================================
// Legacy Thread Replies (Daily Sync)
// ============================================================================

export interface LegacyThreadReplyOptions {
  channelId: string;
  workspaceId: string;
  /** Unix timestamp string — only collect replies posted at or after this time */
  repliesSinceTs: string;
  /** Unix timestamp string — how far back to scan for parent messages (e.g. 30 days ago) */
  scanOldestTs: string;
  includeAttachments?: boolean;
  includeDeactivatedUsers?: boolean;
  includeBotMessages?: boolean;
  token?: string;
}

/**
 * Scan the last N days of channel history and find old threads (parent message
 * posted before `repliesSinceTs`) that received new replies on or after
 * `repliesSinceTs`.  For each such thread, only the new replies are fetched
 * and returned as SlackMessage objects ready for ingestion.
 *
 * Used by the daily nightly sync to capture today's replies on older
 * conversations without re-ingesting the entire channel history.
 */
export async function extractLegacyThreadReplies(
  options: LegacyThreadReplyOptions,
): Promise<SlackMessage[]> {
  const {
    channelId,
    workspaceId,
    repliesSinceTs,
    scanOldestTs,
    includeAttachments = true,
    includeDeactivatedUsers = true,
    includeBotMessages = false,
    token: overrideToken,
  } = options;

  const client = overrideToken ? new WebClient(overrideToken) : getSlackClient();
  const userCache: UserInfoCache = new Map();

  const sinceFloat = parseFloat(repliesSinceTs);
  const oldestFloat = parseFloat(scanOldestTs);

  // ── Step 1: Scan channel history to find old threads with new replies ──────
  logger.info('[Migration:LegacyReplies] Scanning channel history for old threads with new replies', {
    channelId,
    repliesSinceTs,
    scanOldestTs,
  });

  const oldThreadsWithNewReplies: any[] = [];
  let cursor: string | undefined;

  do {
    const result: ConversationsHistoryResponse = await retryWithBackoff(() =>
      client.conversations.history({
        channel: channelId,
        oldest: scanOldestTs,
        limit: 1000,
        cursor,
      }),
    );

    if (!result.ok || !result.messages) break;

    for (const msg of result.messages) {
      const msgTs = parseFloat((msg as { ts?: string }).ts ?? '0');
      const latestReply = parseFloat((msg as { latest_reply?: string }).latest_reply ?? '0');

      // Parent message is OLDER than the sync window AND got a reply WITHIN the sync window
      if (
        msgTs >= oldestFloat &&
        msgTs < sinceFloat &&
        latestReply >= sinceFloat &&
        ((msg as { reply_count?: number }).reply_count ?? 0) > 0
      ) {
        oldThreadsWithNewReplies.push(msg);
      }
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  if (oldThreadsWithNewReplies.length === 0) {
    logger.info('[Migration:LegacyReplies] No old threads with new replies found', { channelId });
    return [];
  }

  logger.info('[Migration:LegacyReplies] Found old threads with new replies', {
    channelId,
    threadCount: oldThreadsWithNewReplies.length,
  });

  // ── Step 2: Fetch pinned message timestamps ───────────────────────────────
  const pinnedMessageTs = await fetchPinnedMessageTimestamps(client, channelId);

  // ── Step 3: Pre-fetch user info for parent messages ───────────────────────
  const parentUserIds = oldThreadsWithNewReplies
    .filter((m) => !m.bot_id && m.user)
    .map((m) => m.user as string);
  await prefetchUserInfo(parentUserIds, userCache, workspaceId, overrideToken);

  // ── Step 4: For each thread, fetch only new replies and transform ──────────
  const results: SlackMessage[] = [];

  for (const parentMsg of oldThreadsWithNewReplies) {
    try {
      // Fetch replies posted at/after repliesSinceTs only
      const newReplies: any[] = [];
      let replyCursor: string | undefined;

      do {
        const replyResult: ConversationsRepliesResponse = await retryWithBackoff(() =>
          client.conversations.replies({
            channel: channelId,
            ts: parentMsg.ts,
            oldest: repliesSinceTs,
            limit: 1000,
            cursor: replyCursor,
          }),
        );

        if (!replyResult.ok || !replyResult.messages) break;

        // conversations.replies includes the parent as first message — skip it
        const replies = replyResult.messages.filter(
          (m) =>
            m.ts !== parentMsg.ts &&
            isHumanMessage(m, 'thread', [], includeBotMessages),
        );
        newReplies.push(...replies);

        replyCursor = replyResult.response_metadata?.next_cursor;
      } while (replyCursor);

      if (newReplies.length === 0) continue;

      // Pre-fetch user info for the new reply authors
      const replyUserIds = newReplies
        .filter((r) => !r.bot_id && r.user)
        .map((r) => r.user as string);
      await prefetchUserInfo(replyUserIds, userCache, workspaceId, overrideToken);

      // Transform: parent message shell + only the new replies
      const slackMsg = await transformMessage(
        parentMsg,
        newReplies,
        userCache,
        includeAttachments,
        includeDeactivatedUsers,
        includeBotMessages,
        pinnedMessageTs,
        workspaceId,
        overrideToken,
      );

      results.push(slackMsg);

      logger.info('[Migration:LegacyReplies] Processed old thread', {
        threadTs: parentMsg.ts,
        newRepliesCount: newReplies.length,
      });
    } catch (error) {
      logger.error('[Migration:LegacyReplies] Error processing thread', {
        threadTs: parentMsg.ts,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info('[Migration:LegacyReplies] Extraction complete', {
    channelId,
    threadsWithNewReplies: results.length,
  });

  return results;
}