/**
 * Slack Migration Service
 * Handles batch processing of Slack channel migrations
 */

import { logger } from '../../utils/logger';
import { getMigrationMessageBlocks, getMigrationMessageFallbackText } from './utils/blockKit';
import { postMessage } from './utils/postMessage';
import { extractChannelHistory, extractLegacyThreadReplies, UserInfoCache, getUserInfo } from './utils/extractConversation';
import { extractChannelMembers } from './utils/extractChannelMembers';
import {
  findOrCreateUser,
  ingestConversationSlack,
} from '../scripts/ingestConversationSlack';
import { ChannelRepository } from '../../database/repositories/channelRepository';
import { ChannelParticipantRepository } from '../../database/repositories/channelParticipantRepository';
import { UserRepository } from '../../database/repositories/users';
import { WebClient } from '@slack/web-api';
import { config } from '../../config/env';
import { getBotConfigByWorkspaceId } from './slackMigrationBotConfig';
import { vespaQueue } from '@/queues/vespaQueue';
import { channelSchema } from '@/vespa/src/types';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';

async function pushVespaJobForChannel(channelId: string, userId: string, workspaceId?: string): Promise<void> {
  vespaQueue.addJob({
    schema: channelSchema,
    jobType: 'feed',
    docId: channelId,
    ...(workspaceId ? { workspaceId } : {}),
  }).catch(async (error) => {
    logger.error(`[SlackMigration] Error queuing Vespa job for channel ${channelId}:`, error);
    // Log failed insertion to Postgres for later retry
    try {
      if (db.vespaInsertionLogs) {
        await db.vespaInsertionLogs.create({
          data: {
            status: 'FAILED',
            type: 'INSERT',
            entityId: channelId,
            entityType: channelSchema,
            namespace: NAMESPACE,
            errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
            errorDetails: JSON.stringify(error),
            userId,
            createdAt: new Date(),
          },
        });
      }
    } catch (dbError) {
      logger.error('[SlackMigration] Failed to log Vespa channel insertion error to database:', dbError);
    }
  });
}

/**
 * Find an existing channel by name in the workspace, or create a new one.
 * Used when the Google Sheet row has no xyneChannelId but has a projectId.
 */
export async function resolveOrCreateChannel(
  channelName: string,
  slackChannelId: string,
  projectId: string,
  workspaceId: string,
  botToken?: string,
): Promise<string | null> {
  const channelRepo = new ChannelRepository();

  // 1. Look for existing channel with same name (case-insensitive) in this workspace
  const existing = await db.channel.findFirst({
    where: {
      name: { equals: channelName, mode: 'insensitive' },
      workspaceId,
    },
  });

  if (existing) {
    logger.info('[Migration] Found existing channel by name — reusing', {
      name: channelName,
      channelId: existing.id,
      workspaceId,
    });
    return existing.id;
  }

  // 2. Find creator user: prefer john.doe@gmail.com, fallback to john.doe@gmail.com
  let creatorUser = await db.user.findFirst({
    where: { workspaceId, email: 'john.doe@gmail.com' },
  });

  if (!creatorUser) {
    creatorUser = await db.user.findFirst({
      where: { workspaceId, email: 'john.doe@gmail.com' },
    });
  }

  if (!creatorUser) {
    logger.error('[Migration] No suitable creator user found in workspace for channel creation', { workspaceId });
    return null;
  }

  // 3. Determine visibility from Slack channel (default PUBLIC if API fails)
  let visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC';
  if (botToken) {
    try {
      const client = new WebClient(botToken);
      const info = await client.conversations.info({ channel: slackChannelId });
      if (info.channel?.is_private) {
        visibility = 'PRIVATE';
      }
      logger.info('[Migration] Resolved Slack channel visibility', {
        slackChannelId,
        isPrivate: info.channel?.is_private,
        visibility,
      });
    } catch (error) {
      logger.warn('[Migration] Failed to fetch Slack channel info, defaulting to PUBLIC', {
        slackChannelId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // 4. Create the channel
  try {
    const newChannel = await channelRepo.create({
      scopeType: 'DEFAULT',
      name: channelName,
      projectId,
      workspaceId,
      createdBy: creatorUser.id,
      visibility,
    });

    logger.info('[Migration] Created new channel for migration', {
      name: channelName,
      channelId: newChannel.id,
      workspaceId,
      visibility,
    });
    return newChannel.id;
  } catch (error) {
    logger.error('[Migration] Failed to create channel', {
      name: channelName,
      workspaceId,
      visibility,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface MigrationInput {
  syncDate?: string | null;
  /** Optional explicit end date (YYYY-MM-DD). If omitted, defaults to today end-of-day.
   *  For daily nightly runs, set this to yesterday to avoid ingesting today's messages twice. */
  syncEndDate?: string | null;
  syncOptions?: string[];
  userId?: string;
  channelId?: string;
  xyneSpaceChannelId?: string;
  /** Optional user token (xoxp-...) to use instead of the bot token. Required for DMs. */
  userToken?: string;
  /** Whether to post the final @channel announcement to the source Slack channel. Defaults to true. */
  postChannelAnnouncement?: boolean;
  /** True for daily nightly runs — triggers a 30-day back-scan to pick up
   *  today's replies on older conversations (threads whose parent was posted
   *  before the current sync window). */
  isDaily?: boolean;
  /**
   * Called after each 7-day time batch completes successfully.
   * Receives the batch's endDate (YYYY-MM-DD) so callers can checkpoint
   * progress — enabling resume from the correct batch after a pod restart.
   */
  onBatchComplete?: (batchEndDate: string) => Promise<void>;
  /**
   * DM flow only: when true, the per-batch ingest will NOT mark the channel
   * isMigrated. runMigrationDm sets isMigrated once, after all batches finish,
   * so re-runs can skip fully-migrated DMs and resume interrupted ones.
   */
  skipChannelMigratedUpdate?: boolean;
}

export interface MigrationResult {
  success: boolean;
  messageTs?: string;
  channelId?: string;
  error?: string;
}

interface TimeBatch {
  startDate: string;
  endDate: string;
  batchNumber: number;
  totalBatches: number;
}

interface BatchResult {
  messages: number;
  replies: number;
}

interface ParticipantFailure {
  slackUserId: string;
  userEmail?: string;
  userName?: string;
  reason: string;
}

interface UserToAdd {
  slackUserId: string;
  xyneUserId: string;
  userEmail?: string;
  userName?: string;
}

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE_DAYS = 7;
const BATCH_DELAY_MS = 5000; // 5 sec
/** Max combined (top-level + thread replies) messages ingested per sub-batch */
const INGEST_SUB_BATCH_SIZE = 50;
/** Delay between sub-batches to avoid OOM / DB spikes */
const INGEST_SUB_BATCH_DELAY_MS = 2000; // 2 second

/** Resolve per-workspace notifications flag, falling back to global config */
function getEnableNotifications(workspaceId?: string): boolean {
  return getBotConfigByWorkspaceId(workspaceId || '').notificationsEnabled;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Split time range into 30-day batches
 */
function createTimeBatches(startDate: string, endDate?: string | null): TimeBatch[] {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();

  if (isNaN(start.getTime())) {
    throw new Error(`Invalid start date: ${startDate}`);
  }

  if (isNaN(end.getTime())) {
    throw new Error(`Invalid end date: ${endDate || 'undefined'}`);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const batches: TimeBatch[] = [];
  let currentStart = new Date(start);

  while (currentStart <= end) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + BATCH_SIZE_DAYS - 1);
    currentEnd.setHours(23, 59, 59, 999);

    if (currentEnd > end) {
      currentEnd.setTime(end.getTime());
    }

    batches.push({
      startDate: currentStart.toISOString().split('T')[0],
      endDate: currentEnd.toISOString().split('T')[0],
      batchNumber: batches.length + 1,
      totalBatches: 0, // Will be set after loop
    });

    currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() + 1);
    currentStart.setHours(0, 0, 0, 0);
  }

  batches.forEach((batch) => {
    batch.totalBatches = batches.length;
  });

  return batches;
}

/**
 * Convert date to Unix timestamp string
 */
function dateToUnixTimestamp(date: Date): string {
  return Math.floor(date.getTime() / 1000).toString();
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Process a single time batch
 */
async function processBatch(
  batch: TimeBatch,
  input: MigrationInput,
  externalSourceName: string,
  messageTs: string | null | undefined,
  logChannelId: string,
  botToken?: string,
): Promise<BatchResult> {
  const { channelId, xyneSpaceChannelId, syncOptions, userToken } = input;

  if (!channelId) {
    throw new Error('channelId is required');
  }

  // Resolve workspaceId from the target Xyne channel up-front so it can be
  // threaded into extractChannelHistory for correct user lookups/creation.
  const channelRepo = new ChannelRepository();
  const xyneChannel = xyneSpaceChannelId ? await channelRepo.findById(xyneSpaceChannelId) : null;
  const workspaceId = xyneChannel?.workspaceId || config.defaultWorkspaceId;
  if (!workspaceId) {
    throw new Error('workspaceId is required for Slack conversation ingestion');
  }

  // Convert dates to Unix timestamps
  const oldestDate = new Date(batch.startDate);
  oldestDate.setHours(0, 0, 0, 0);
  const oldestTimestamp = dateToUnixTimestamp(oldestDate);

  const latestDate = new Date(batch.endDate);
  latestDate.setHours(23, 59, 59, 999);
  const latestTimestamp = dateToUnixTimestamp(latestDate);

  // Notify user
  if (getEnableNotifications(workspaceId) && messageTs) {
    await postMessage({
      channelId: logChannelId,
      text: `🔄 Processing batch ${batch.batchNumber}/${batch.totalBatches} (${batch.startDate} to ${batch.endDate})`,
      threadTs: messageTs,
      botToken,
    });
  }

  // Extract channel history
  const conversationHistory = await extractChannelHistory({
    channelId,
    workspaceId,
    oldest: oldestTimestamp,
    latest: latestTimestamp,
    includeThreads: syncOptions?.includes('include_threads'),
    includeAttachments: syncOptions?.includes('include_attachments'),
    includeDeactivatedUsers: syncOptions?.includes('include_deactivated_users'),
    includeBotMessages: syncOptions?.includes('include_bot_messages'),
    token: userToken || botToken,
  });

  if (getEnableNotifications(workspaceId) && messageTs) {
    const replyCount = conversationHistory.reduce((sum, m) => sum + (m.replies?.length ?? 0), 0);
    await postMessage({
      channelId: logChannelId,
      text: `✅ Batch ${batch.batchNumber}/${batch.totalBatches} extracted: ${conversationHistory.length} top-level messages, ${replyCount} thread replies`,
      threadTs: messageTs,
      botToken,
    });
  }

  // Ingest if xyneSpaceChannelId is provided
  if (xyneSpaceChannelId && conversationHistory.length > 0) {
    if (!xyneChannel) {
      throw new Error('workspaceId is required for Slack conversation ingestion');
    }

    // ── Sub-batch ingestion: chunk into groups of INGEST_SUB_BATCH_SIZE ────
    // Each message's "weight" = 1 (top-level) + number of thread replies.
    // We accumulate messages until the running weight would exceed the limit,
    // then flush and wait 1 second before continuing. This prevents OOM and
    // DB spikes when a single 30-day batch contains thousands of thread replies.
    const subBatches: (typeof conversationHistory)[] = [];
    let currentSubBatch: typeof conversationHistory = [];
    let currentWeight = 0;

    for (const msg of conversationHistory) {
      const msgWeight = 1 + (msg.replies?.length ?? 0);
      if (currentWeight + msgWeight > INGEST_SUB_BATCH_SIZE && currentSubBatch.length > 0) {
        subBatches.push(currentSubBatch);
        currentSubBatch = [];
        currentWeight = 0;
      }
      currentSubBatch.push(msg);
      currentWeight += msgWeight;
    }
    if (currentSubBatch.length > 0) subBatches.push(currentSubBatch);

    logger.info('[Migration] Ingesting sub-batches', {
      channelId,
      totalSubBatches: subBatches.length,
      subBatchSize: INGEST_SUB_BATCH_SIZE,
    });

    for (let si = 0; si < subBatches.length; si++) {
      const subBatch = subBatches[si];
      const subBatchReplies = subBatch.reduce((s, m) => s + (m.replies?.length ?? 0), 0);

      logger.info(`[Migration] Ingesting sub-batch ${si + 1}/${subBatches.length}`, {
        topLevel: subBatch.length,
        replies: subBatchReplies,
      });

      await ingestConversationSlack({
        slackMessages: subBatch,
        externalSourceName,
        channelId: xyneSpaceChannelId,
        workspaceId,
        ...(input.userToken && { userToken: input.userToken }),
        ...(botToken && { botToken }),
        skipChannelMigratedUpdate: input.skipChannelMigratedUpdate,
      });

      if (si < subBatches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, INGEST_SUB_BATCH_DELAY_MS));
      }
    }

    if (getEnableNotifications(workspaceId) && messageTs) {
      const totalReplies = conversationHistory.reduce((s, m) => s + (m.replies?.length ?? 0), 0);
      await postMessage({
        channelId: logChannelId,
        text: `✅ Batch ${batch.batchNumber}/${batch.totalBatches} ingested: ${conversationHistory.length} top-level messages, ${totalReplies} thread replies (${subBatches.length} sub-batch${subBatches.length !== 1 ? 'es' : ''})`,
        threadTs: messageTs,
        botToken,
      });
    }
  }

  const totalReplies = conversationHistory.reduce((s, m) => s + (m.replies?.length ?? 0), 0);
  return {
    messages: conversationHistory.length,
    replies: totalReplies,
  };
}

/**
 * Validate input and channel
 */
async function validateInput(input: MigrationInput): Promise<void> {
  if (!input.channelId) {
    throw new Error('channelId is required');
  }

  if (!input.syncDate) {
    throw new Error('syncDate is required');
  }

  if (input.xyneSpaceChannelId) {
    const channelRepo = new ChannelRepository();
    const xyneChannel = await channelRepo.findById(input.xyneSpaceChannelId);

    if (!xyneChannel) {
      const wsId = xyneChannel ? (xyneChannel as any).workspaceId : '';
      const vBotToken = getBotConfigByWorkspaceId(wsId).slackBotToken;
      if (getEnableNotifications(wsId) && input.userId && vBotToken) {
        const client = new WebClient(vBotToken);
        await client.chat.postEphemeral({
          channel: input.channelId,
          user: input.userId,
          text: '❌ Xyne channel does not exist in database. Please provide a valid Xyne channel ID.',
        });
      }
      throw new Error('Xyne Space channel not found in database');
    }
  }
}

// ============================================================================
// Participant Resolution + Insertion (split for migration performance)
// ============================================================================

/**
 * Phase 1 of participant sync: resolves every Slack channel member to a Xyne
 * user, creating the user in the DB if they do not exist yet.
 *
 * This MUST run before message ingestion so that `resolveSlackMentions` can
 * embed correct `data-user-id` attributes into message HTML. If a user is not
 * in the DB when a message is ingested, the @mention becomes permanent plain
 * text with no retroactive fix.
 *
 * Intentionally does NOT insert `channel_participant` or `channel_user_status`
 * rows — those are handled by `addChannelParticipantsAfterMigration` once all
 * messages are in the DB, so that Zero's real-time sync has zero subscribers
 * during the (potentially large) ingestion phase.
 *
 * Returns the resolved user list and the channel creator's Slack ID so that
 * the caller can pass them directly to `addChannelParticipantsAfterMigration`.
 */
export async function resolveAndCreateChannelUsers(
  slackChannelId: string,
  xyneChannelId: string,
): Promise<{ usersToBeAdded: UserToAdd[]; channelCreatorSlackId: string | undefined }> {
  logger.info('[Migration] Resolving channel members (user creation only)', {
    slackChannelId,
    xyneChannelId,
  });

  // Resolve workspaceId up front so we can use per-workspace bot token
  const resolveChannelRepo = new ChannelRepository();
  const resolvedChannel = await resolveChannelRepo.findById(xyneChannelId);
  const resolvedWorkspaceId = resolvedChannel?.workspaceId ?? '';
  const resolvedBotToken = getBotConfigByWorkspaceId(resolvedWorkspaceId).slackBotToken;

  // Fetch channel info to get the creator
  let channelCreatorSlackId: string | undefined;
  try {
    const client = new WebClient(resolvedBotToken);
    const channelInfo = await client.conversations.info({ channel: slackChannelId });
    channelCreatorSlackId = channelInfo.channel?.creator;
    logger.info('[Migration] Channel creator fetched', { slackChannelId, channelCreatorSlackId });
  } catch (error) {
    logger.warn('[Migration] Failed to fetch channel info for creator', {
      slackChannelId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const channelMemberIds = await extractChannelMembers(slackChannelId, resolvedBotToken);
  const userRepo = new UserRepository();
  const channelRepo = new ChannelRepository();
  const userInfoCache: UserInfoCache = new Map();
  const userCache = new Map<string, { id: string; isDeactivated: boolean }>();

  const channel = await channelRepo.findById(xyneChannelId);
  const workspaceId = channel?.workspaceId ?? '';

  const usersToBeAdded: UserToAdd[] = [];
  const failedUsers: ParticipantFailure[] = [];

  for (const memberId of channelMemberIds) {
    try {
      const userInfo = await getUserInfo(memberId, userInfoCache, workspaceId, resolvedBotToken);
      if (userInfo?.isBot) {
        logger.info('[Migration] Skipping bot member', { memberId });
        continue;
      }
      if (userInfo && (userInfo.userId || (userInfo.userEmail && userInfo.userName))) {
        let resolvedUserId = userInfo.userId;
        if (!resolvedUserId && userInfo.userEmail && userInfo.userName) {
          resolvedUserId = await findOrCreateUser(
            userInfo.userEmail,
            userInfo.userName,
            userInfo.isDeactivated ?? false,
            userRepo,
            userCache,
            workspaceId
          );
        }
        if (resolvedUserId) {
          usersToBeAdded.push({
            slackUserId: memberId,
            xyneUserId: resolvedUserId,
            userEmail: userInfo.userEmail,
            userName: userInfo.userName,
          });
        } else {
          failedUsers.push({
            slackUserId: memberId,
            userEmail: userInfo.userEmail,
            userName: userInfo.userName,
            reason: 'Could not resolve user ID',
          });
        }
      } else {
        failedUsers.push({
          slackUserId: memberId,
          reason: 'No user info found in Slack',
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[Migration] Failed to resolve channel participant', { memberId, error: reason });
      failedUsers.push({ slackUserId: memberId, reason });
    }
  }

  logger.info('[Migration] Channel member resolution complete', {
    xyneChannelId,
    totalMembers: channelMemberIds.length,
    validUsers: usersToBeAdded.length,
    failedUsers: failedUsers.length,
  });

  // Fail fast if any member could not be resolved — same behaviour as before
  if (failedUsers.length > 0) {
    const failureDetails = failedUsers
      .map((f) => {
        const userInfo = f.userName || f.userEmail
          ? ` (${f.userName || ''}${f.userName && f.userEmail ? ' - ' : ''}${f.userEmail || ''})` : '';
        return `- ${f.slackUserId}${userInfo}: ${f.reason}`;
      })
      .join('\n');
    throw new Error(
      `❌ Migration failed: ${failedUsers.length} participant(s) could not be resolved:\n${failureDetails}`
    );
  }

  return { usersToBeAdded, channelCreatorSlackId };
}

/**
 * Phase 2 of participant sync: inserts `channel_participant` and
 * `channel_user_status` rows for the users resolved by
 * `resolveAndCreateChannelUsers`.
 *
 * Must be called AFTER all messages have been ingested so that:
 *  - Zero's real-time push has 0 subscribers during ingestion (no per-message
 *    fan-out to hundreds of clients).
 *  - `conversationSeenCutoffAt` is set to `new Date()` so all already-ingested
 *    historical messages are immediately marked as seen — no spurious unread
 *    badge for migrated content.
 */
export async function addChannelParticipantsAfterMigration(
  xyneChannelId: string,
  usersToBeAdded: UserToAdd[],
  channelCreatorSlackId: string | undefined,
): Promise<void> {
  if (usersToBeAdded.length === 0) return;

  const channelRepo = new ChannelRepository();
  const channel = await channelRepo.findById(xyneChannelId);
  const workspaceId = channel?.workspaceId ?? '';

  const channelParticipantRepo = new ChannelParticipantRepository();

  // All migrated messages are already in the DB — mark them all as seen by
  // passing `now` as the cutoff. This bypasses getConversationSeenCutoffAt
  // entirely and ensures no user gets an unread badge for historical content.
  const seenCutoffAt = new Date();

  const creatorUser = channelCreatorSlackId
    ? usersToBeAdded.find((u) => u.slackUserId === channelCreatorSlackId)
    : undefined;
  const memberUsers = usersToBeAdded.filter((u) => u.slackUserId !== channelCreatorSlackId);

  // Add the channel creator as ADMIN
  if (creatorUser) {
    const existingParticipant = await channelParticipantRepo.addParticipant(
      xyneChannelId,
      creatorUser.xyneUserId,
      'ADMIN'
    );
    // addParticipant returns the existing record unchanged if the user is already
    // a participant — explicitly promote to ADMIN if needed.
    if (existingParticipant.role !== 'ADMIN') {
      await channelParticipantRepo.updateParticipantRole(
        xyneChannelId,
        creatorUser.xyneUserId,
        'ADMIN'
      );
    }
    logger.info('[Migration] Channel creator added as ADMIN', {
      xyneChannelId,
      creatorSlackId: channelCreatorSlackId,
      creatorXyneId: creatorUser.xyneUserId,
    });
  }

  // Batch-add all remaining members in a single transaction
  const memberUserIds = memberUsers.map((u) => u.xyneUserId);
  if (memberUserIds.length > 0) {
    const result = await channelParticipantRepo.addParticipantsBatch(
      xyneChannelId,
      memberUserIds,
      'MEMBER',
      false,
      seenCutoffAt,
    );
    logger.info('[Migration] Channel participants batch added after migration', {
      xyneChannelId,
      addedCount: result.addedCount,
      existingCount: result.existingCount,
    });
  }

  // Queue Vespa re-indexing for the channel
  const allUserIds = usersToBeAdded.map((u) => u.xyneUserId);
  await pushVespaJobForChannel(xyneChannelId, allUserIds[0], workspaceId || undefined);

  logger.info('[Migration] Channel participants added after migration complete', {
    xyneChannelId,
    total: usersToBeAdded.length,
  });
}

/**
 * @deprecated Use `resolveAndCreateChannelUsers` + `addChannelParticipantsAfterMigration`
 * instead. Kept for the `/sync-participants` command which intentionally adds
 * participants in standalone mode (batchSync=true path).
 */
export async function addChannelParticipantsBeforeMigration(
  slackChannelId: string,
  xyneChannelId: string,
  batchSync: boolean = false,
  threadTs?: string,
  logChannelId?: string
): Promise<void> {
  logChannelId = logChannelId || slackChannelId;

  const { usersToBeAdded, channelCreatorSlackId } = await resolveAndCreateChannelUsers(
    slackChannelId,
    xyneChannelId,
  );

  if (usersToBeAdded.length === 0) return;

  const channelRepo = new ChannelRepository();
  const channel = await channelRepo.findById(xyneChannelId);
  const workspaceId = channel?.workspaceId ?? '';

  const channelParticipantRepo = new ChannelParticipantRepository();
  const botToken = getBotConfigByWorkspaceId(workspaceId).slackBotToken;

  const creatorUser = channelCreatorSlackId
    ? usersToBeAdded.find((u) => u.slackUserId === channelCreatorSlackId)
    : undefined;
  const memberUsers = usersToBeAdded.filter((u) => u.slackUserId !== channelCreatorSlackId);

  if (creatorUser) {
    const existingParticipant = await channelParticipantRepo.addParticipant(
      xyneChannelId,
      creatorUser.xyneUserId,
      'ADMIN'
    );
    if (existingParticipant.role !== 'ADMIN') {
      await channelParticipantRepo.updateParticipantRole(
        xyneChannelId,
        creatorUser.xyneUserId,
        'ADMIN'
      );
    }
    logger.info('[Migration] Channel creator added as ADMIN', {
      xyneChannelId,
      creatorSlackId: channelCreatorSlackId,
      creatorXyneId: creatorUser.xyneUserId,
    });
  }

  const memberUserIds = memberUsers.map((u) => u.xyneUserId);
  if (memberUserIds.length > 0) {
    if (batchSync) {
      const BATCH_SIZE = 50;
      const PARTICIPANT_BATCH_DELAY_MS = 60000;
      for (let i = 0; i < memberUserIds.length; i += BATCH_SIZE) {
        const chunk = memberUserIds.slice(i, i + BATCH_SIZE);
        const result = await channelParticipantRepo.addParticipantsBatch(xyneChannelId, chunk, 'MEMBER');
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(memberUserIds.length / BATCH_SIZE);
        logger.info('[Migration] Participant batch added', {
          xyneChannelId, batchNum, totalBatches,
          addedCount: result.addedCount, existingCount: result.existingCount,
        });
        if (getEnableNotifications(workspaceId)) {
          await postMessage({
            channelId: logChannelId,
            text: `✅ Batch ${batchNum}/${totalBatches}: added ${result.addedCount} participant(s).`,
            threadTs,
            botToken,
          });
        }
        if (i + BATCH_SIZE < memberUserIds.length) {
          if (getEnableNotifications(workspaceId)) {
            await postMessage({
              channelId: logChannelId,
              text: `⏳ Waiting 60 seconds before next batch...`,
              threadTs,
              botToken,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, PARTICIPANT_BATCH_DELAY_MS));
        }
      }
    } else {
      const result = await channelParticipantRepo.addParticipantsBatch(
        xyneChannelId, memberUserIds, 'MEMBER'
      );
      logger.info('[Migration] Channel participants batch added', {
        xyneChannelId, addedCount: result.addedCount, existingCount: result.existingCount,
      });
    }
  }

  const allUserIds = usersToBeAdded.map((u) => u.xyneUserId);
  await pushVespaJobForChannel(xyneChannelId, allUserIds[0], workspaceId || undefined);
}

/**
 * Run migration with batch processing
 */
export async function runMigration(input: MigrationInput): Promise<MigrationResult> {
  logger.info('[Migration] Starting migration', {
    syncDate: input.syncDate,
    channelId: input.channelId,
  });

  let messageTs: string | null = null;

  // All progress/error messages go to the dedicated log channel if configured,
  // falling back to the source channel.
  // workspaceId resolved from the channel; defaults applied in getBotConfigByWorkspaceId
  let wsConfig = getBotConfigByWorkspaceId(config.defaultWorkspaceId || '');
  // resolvedLogChannelId is re-set after workspaceId is known inside the try block
  let resolvedLogChannelId = wsConfig.slackMigrationLogChannelId || input.channelId!;

  try {
    // Validate input
    await validateInput(input);

    let xyneSpaceChannelLink: string | undefined;
    if (input.xyneSpaceChannelId) {
      const channelRepo = new ChannelRepository();
      const xyneChannel = await channelRepo.findById(input.xyneSpaceChannelId);
      if (xyneChannel) {
        const channelName = xyneChannel.name;
        const workspaceId = xyneChannel.workspaceId;
        wsConfig = getBotConfigByWorkspaceId(workspaceId);
        xyneSpaceChannelLink = `<https://spaces.xyne.juspay.net/${workspaceId}/chat/dir/${input.xyneSpaceChannelId}|${channelName}>`;
      }
    }
    // Re-resolve resolvedLogChannelId now that we have the real workspaceId config
    resolvedLogChannelId = wsConfig.slackMigrationLogChannelId || input.channelId!;

    // Post initial message to log channel
    const blocks = getMigrationMessageBlocks({
      syncDate: input.syncDate!,
      userId: input.userId,
      syncOptions: input.syncOptions,
      xyneSpaceChannelId: xyneSpaceChannelLink || input.xyneSpaceChannelId,
    });
    const fallbackText = getMigrationMessageFallbackText(input.syncDate!);

    messageTs = wsConfig.notificationsEnabled
      ? await postMessage({
          channelId: resolvedLogChannelId,
          text: fallbackText,
          blocks,
          botToken: wsConfig.slackBotToken,
        })
      : null;

    // ── Step 1: resolve + create all Slack members as Xyne users ────────────
    // This must happen before message ingestion so that resolveSlackMentions
    // can embed correct data-user-id attributes in message HTML.
    // We do NOT insert channel_participant rows yet — that happens after
    // ingestion (Step 3) so that Zero has 0 subscribers during the bulk write.
    let resolvedUsers: { usersToBeAdded: UserToAdd[]; channelCreatorSlackId: string | undefined } | null = null;
    if (input.xyneSpaceChannelId) {
      if (wsConfig.notificationsEnabled && messageTs) {
        await postMessage({
          channelId: resolvedLogChannelId,
          text: '🔄 Resolving channel members...',
          threadTs: messageTs,
          botToken: wsConfig.slackBotToken,
        });
      }
      resolvedUsers = await resolveAndCreateChannelUsers(input.channelId!, input.xyneSpaceChannelId);
    }

    // ── Step 2: ingest messages ───────────────────────────────────────────────
    // Zero has 0 subscribers for this channel at this point, so no per-message
    // fan-out to connected clients occurs during ingestion.
    const batches = createTimeBatches(input.syncDate!, input.syncEndDate);

    if (wsConfig.notificationsEnabled && messageTs) {
      await postMessage({
        channelId: resolvedLogChannelId,
        text: `🔄 Migration initiated - Processing ${batches.length} batches (${BATCH_SIZE_DAYS} days each)`,
        threadTs: messageTs,
        botToken: wsConfig.slackBotToken,
      });
    }

    // External source name format: slackMigration-{slackChannelId}
    const externalSourceName = `slackMigration-${input.channelId}`;

    // Process batches
    let totalMessages = 0;
    let totalReplies = 0;
    let batchFailed = false;
    let failedBatchNumber: number | undefined;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      try {
        const result = await processBatch(batch, input, externalSourceName, messageTs, resolvedLogChannelId, wsConfig.slackBotToken);
        totalMessages += result.messages;
        totalReplies += result.replies;

        // Checkpoint: notify caller that this batch window is fully ingested.
        // Callers (e.g. slackMigrationWorker) use this to persist lastSyncedDate
        // so a pod restart can resume from the next batch rather than the start.
        if (input.onBatchComplete) {
          await input.onBatchComplete(batch.endDate).catch((err) =>
            logger.warn('[Migration] onBatchComplete callback failed (non-fatal)', { batchEndDate: batch.endDate, err }),
          );
        }

        // Delay between batches (except last)
        if (i < batches.length - 1) {
          if (wsConfig.notificationsEnabled && messageTs) {
            await postMessage({
              channelId: resolvedLogChannelId,
              text: `⏳ Waiting ${BATCH_DELAY_MS / 1000} seconds before next batch...`,
              threadTs: messageTs,
              botToken: wsConfig.slackBotToken,
            });
          }

          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (error) {
        logger.error('[Migration] Batch processing failed', {
          batch: `${batch.batchNumber}/${batch.totalBatches}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        if (wsConfig.notificationsEnabled && messageTs) {
          await postMessage({
            channelId: resolvedLogChannelId,
            text: `❌ Batch ${batch.batchNumber}/${batch.totalBatches} failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            threadTs: messageTs,
            botToken: wsConfig.slackBotToken,
          });
        }
        // Stop processing further batches. lastSyncedDate (col H) reflects the
        // last *successful* batch end date — a restart will resume from exactly
        // this failed batch rather than skipping it.
        batchFailed = true;
        failedBatchNumber = batch.batchNumber;
        break;
      }
    }

    // ── Step 2b: legacy thread replies (daily mode only) ─────────────────────
    // Scan the past 30 days of channel history and ingest any replies posted
    // TODAY on threads whose parent message predates the sync window.
    if (!batchFailed && input.isDaily && input.channelId && input.xyneSpaceChannelId) {
      try {
        const channelRepo = new ChannelRepository();
        const xyneChannelForLegacy = await channelRepo.findById(input.xyneSpaceChannelId);
        const legacyWorkspaceId = xyneChannelForLegacy?.workspaceId || config.defaultWorkspaceId;

        // repliesSinceTs = start of the sync day (same as what processBatch used as oldest)
        const syncDayStart = new Date(input.syncDate!);
        syncDayStart.setHours(0, 0, 0, 0);
        const repliesSinceTs = dateToUnixTimestamp(syncDayStart);

        // scanOldestTs = 30 days before the sync day
        const scanStart = new Date(syncDayStart);
        scanStart.setDate(scanStart.getDate() - 30);
        const scanOldestTs = dateToUnixTimestamp(scanStart);

        if (wsConfig.notificationsEnabled && messageTs) {
          await postMessage({
            channelId: resolvedLogChannelId,
            text: '🔄 Scanning for replies on older threads...',
            threadTs: messageTs,
            botToken: wsConfig.slackBotToken,
          });
        }

        const legacyMessages = await extractLegacyThreadReplies({
          channelId: input.channelId,
          workspaceId: legacyWorkspaceId!,
          repliesSinceTs,
          scanOldestTs,
          includeAttachments: input.syncOptions?.includes('include_attachments'),
          includeDeactivatedUsers: input.syncOptions?.includes('include_deactivated_users'),
          includeBotMessages: input.syncOptions?.includes('include_bot_messages'),
          token: input.userToken || wsConfig.slackBotToken,
        });

        if (legacyMessages.length > 0 && xyneChannelForLegacy) {
          const externalSourceNameLegacy = `slackMigration-${input.channelId}`;

          // Sub-batch legacy messages using the same weight-based OOM protection
          // as processBatch (weight = 1 top-level + N replies per message).
          const legacySubBatches: (typeof legacyMessages)[] = [];
          let legacyCurrent: typeof legacyMessages = [];
          let legacyWeight = 0;
          for (const msg of legacyMessages) {
            const msgWeight = 1 + (msg.replies?.length ?? 0);
            if (legacyWeight + msgWeight > INGEST_SUB_BATCH_SIZE && legacyCurrent.length > 0) {
              legacySubBatches.push(legacyCurrent);
              legacyCurrent = [];
              legacyWeight = 0;
            }
            legacyCurrent.push(msg);
            legacyWeight += msgWeight;
          }
          if (legacyCurrent.length > 0) legacySubBatches.push(legacyCurrent);

          for (let lsi = 0; lsi < legacySubBatches.length; lsi++) {
            await ingestConversationSlack({
              slackMessages: legacySubBatches[lsi],
              externalSourceName: externalSourceNameLegacy,
              channelId: input.xyneSpaceChannelId,
              workspaceId: legacyWorkspaceId!,
              ...(input.userToken && { userToken: input.userToken }),
              ...(wsConfig.slackBotToken && { botToken: wsConfig.slackBotToken }),
            });
            if (lsi < legacySubBatches.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, INGEST_SUB_BATCH_DELAY_MS));
            }
          }

          totalMessages += legacyMessages.length;

          if (wsConfig.notificationsEnabled && messageTs) {
            await postMessage({
              channelId: resolvedLogChannelId,
              text: `✅ Ingested ${legacyMessages.length} legacy thread(s) with new replies`,
              threadTs: messageTs,
              botToken: wsConfig.slackBotToken,
            });
          }
        } else {
          logger.info('[Migration] No legacy thread replies found for daily sync', {
            channelId: input.channelId,
          });
        }
      } catch (error) {
        // Non-fatal: log and continue so the main migration result is not affected
        logger.error('[Migration] Legacy thread replies scan failed', {
          channelId: input.channelId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // ── Step 3: add channel participants ─────────────────────────────────────
    // Now that all messages are in the DB:
    //  - Zero subscribers are added for the first time → one bulk sync per client
    //  - conversationSeenCutoffAt = now → no unread badge for migrated content
    if (!batchFailed && resolvedUsers && input.xyneSpaceChannelId) {
      if (wsConfig.notificationsEnabled && messageTs) {
        await postMessage({
          channelId: resolvedLogChannelId,
          text: '🔄 Adding channel participants...',
          threadTs: messageTs,
          botToken: wsConfig.slackBotToken,
        });
      }
      await addChannelParticipantsAfterMigration(
        input.xyneSpaceChannelId,
        resolvedUsers.usersToBeAdded,
        resolvedUsers.channelCreatorSlackId,
      );
    }

    // Post final summary to log channel (threaded)
    if (wsConfig.notificationsEnabled && messageTs) {
      if (batchFailed) {
        await postMessage({
          channelId: resolvedLogChannelId,
          text: `⚠️ Migration incomplete — stopped at batch ${failedBatchNumber}/${batches.length}. Partial data ingested: ${totalMessages} messages, ${totalReplies} replies. Re-queue this channel to resume.`,
          threadTs: messageTs,
          botToken: wsConfig.slackBotToken,
        });
      } else if (input.xyneSpaceChannelId) {
        await postMessage({
          channelId: resolvedLogChannelId,
          text: `🎉 Migration complete!\n\nTop-level messages: ${totalMessages}\nThread replies: ${totalReplies}\nTotal: ${totalMessages + totalReplies}`,
          threadTs: messageTs,
          botToken: wsConfig.slackBotToken,
        });
      } else {
        await postMessage({
          channelId: resolvedLogChannelId,
          text: `🎉 Extraction complete!\n\nTop-level messages extracted: ${totalMessages}\nThread replies: ${totalReplies}\n⚠️ No Xyne channel selected - ingestion skipped`,
          threadTs: messageTs,
          botToken: wsConfig.slackBotToken,
        });
      }
    }

    // Final @channel announcement always goes to the source channel
    if (!batchFailed && wsConfig.notificationsEnabled && input.postChannelAnnouncement !== false) {
      let xyneSpaceWorkspaceId: string | undefined;
      if (input.xyneSpaceChannelId) {
        const channelRepo2 = new ChannelRepository();
        const ch = await channelRepo2.findById(input.xyneSpaceChannelId);
        xyneSpaceWorkspaceId = ch?.workspaceId;
      }
      const xyneSpacesLink = input.xyneSpaceChannelId && xyneSpaceWorkspaceId
        ? `<https://spaces.xyne.juspay.net/${xyneSpaceWorkspaceId}/chat/dir/${input.xyneSpaceChannelId}|Xyne Spaces>`
        : 'Xyne Spaces';
      let finalMessage = `<!channel> This Channel has been migrated to ${xyneSpacesLink}. Please move your conversations there only this channel will be soon archived.`;
      const finalMsgSuffix = wsConfig.migrationFinalMessage;
      if (finalMsgSuffix) {
        finalMessage += `\n${finalMsgSuffix}`;
      }
      await postMessage({
        channelId: input.channelId!,
        text: finalMessage,
        botToken: wsConfig.slackBotToken,
      });
    }

    logger.info('[Migration] Migration completed', {
      totalBatches: batches.length,
      totalMessages,
      batchFailed,
    });

    if (batchFailed) {
      return {
        success: false,
        error: `Stopped at batch ${failedBatchNumber}/${batches.length}`,
        channelId: input.channelId,
      };
    }

    return {
      success: true,
      channelId: input.channelId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('[Migration] Migration failed', {
      error: errorMessage,
    });

    if (messageTs && wsConfig.notificationsEnabled) {
      try {
        await postMessage({
          channelId: resolvedLogChannelId,
          threadTs: messageTs,
          text: `❌ Migration failed: ${errorMessage}`,
          botToken: wsConfig.slackBotToken,
        });
      } catch (error) {
        logger.error('[Migration] postMessage failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

// ============================================================================
// DM Migration
// ============================================================================

export interface DmMigrationInput {
  /** The Slack DM or group-DM channel ID to migrate from (D… or G…) */
  dmChannelId: string;
  /** The Xyne Space channel ID to ingest messages into */
  xyneSpaceChannelId: string;
  /** Personal user token (xoxp-...) that has access to this DM */
  userToken: string;
  /**
   * Unix timestamp (seconds) of when the Slack DM was created.
   * Used as the migration start date so we capture the full history.
   * If not provided, falls back to 1 year ago.
   */
  dmCreatedTimestamp?: number;
  /** Slack user ID of the person who triggered the command */
  userId?: string;
  /** Slack channel to report progress back to (usually the channel the command was typed in) */
  responseChannelId?: string;
}

/**
 * Migrate DM / group-DM messages into a Xyne Space channel.
 *
 * Differences from `runMigration`:
 *  - Does NOT call `addChannelParticipantsBeforeMigration` (conversations.members
 *    fails for 1:1 DMs; participant provisioning is handled in syncDmService).
 *  - Does NOT post the final <!channel> announcement (not applicable for DMs).
 *  - `syncDate` is optional; falls back to 90 days ago.
 */
export async function runMigrationDm(input: DmMigrationInput): Promise<MigrationResult> {
  const { dmChannelId, xyneSpaceChannelId, userToken, userId, responseChannelId } = input;

  // Use the DM creation timestamp so we capture full history from day 1.
  // Falls back to 1 year ago if Slack didn't return a created timestamp.
  const effectiveSyncDate = input.dmCreatedTimestamp
    ? new Date(input.dmCreatedTimestamp * 1000).toISOString().split('T')[0]
    : (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1);
        return d.toISOString().split('T')[0];
      })();

  logger.info('[MigrationDM] Starting DM migration', {
    dmChannelId,
    xyneSpaceChannelId,
    effectiveSyncDate,
    userId,
  });

  let messageTs: string | null = null;
  let dmBotToken: string | undefined;

  try {
    // Validate xyneSpaceChannelId exists in DB
    const channelRepo = new ChannelRepository();
    const xyneChannel = await channelRepo.findById(xyneSpaceChannelId);
    if (!xyneChannel) {
      const dmWsConfig = getBotConfigByWorkspaceId(config.defaultWorkspaceId || '');
      if (getEnableNotifications(config.defaultWorkspaceId) && userId && dmWsConfig.slackBotToken && responseChannelId) {
        const client = new WebClient(dmWsConfig.slackBotToken);
        await client.chat.postEphemeral({
          channel: responseChannelId,
          user: userId,
          text: '❌ Xyne channel does not exist in the database. Please provide a valid Xyne channel ID.',
        });
      }
      throw new Error('Xyne Space channel not found in database');
    }

    const channelName = xyneChannel.name;
    const xyneSpaceWorkspaceId = xyneChannel.workspaceId;
    const dmWsConfig = getBotConfigByWorkspaceId(xyneSpaceWorkspaceId);
    dmBotToken = dmWsConfig.slackBotToken;
    // DM flow (sync-dm): prefer the caller-supplied channel so all updates land
    // in the dedicated sync-dm channel, not the generic workspace migration log.
    const dmLogChannelId = responseChannelId || dmWsConfig.slackMigrationLogChannelId || dmChannelId;
    const xyneSpaceChannelLink = `<https://spaces.xyne.juspay.net/${xyneSpaceWorkspaceId}/chat/dir/${xyneSpaceChannelId}|${channelName}>`;

    // Post thread-starter to log channel
    const blocks = getMigrationMessageBlocks({
      syncDate: effectiveSyncDate,
      userId,
      xyneSpaceChannelId: xyneSpaceChannelLink,
    });
    const fallbackText = getMigrationMessageFallbackText(effectiveSyncDate);

    messageTs = getEnableNotifications(xyneSpaceWorkspaceId)
      ? await postMessage({ channelId: dmLogChannelId, text: fallbackText, blocks, botToken: dmBotToken })
      : null;

    if (getEnableNotifications(xyneSpaceWorkspaceId) && messageTs) {
      await postMessage({
        channelId: dmLogChannelId,
        text: `🔄 DM migration initiated for <#${dmChannelId}> → ${xyneSpaceChannelLink}`,
        threadTs: messageTs,
        botToken: dmBotToken,
      });
    }

    // Create time batches and process
    const batches = createTimeBatches(effectiveSyncDate);

    if (getEnableNotifications(xyneSpaceWorkspaceId) && messageTs) {
      await postMessage({
        channelId: dmLogChannelId,
        text: `🔄 Processing ${batches.length} batch(es) of ${BATCH_SIZE_DAYS} days each`,
        threadTs: messageTs,
        botToken: dmBotToken,
      });
    }

    const externalSourceName = `slackMigration-${dmChannelId}`;
    const migrationInput: MigrationInput = {
      channelId: dmChannelId,
      xyneSpaceChannelId,
      syncDate: effectiveSyncDate,
      userId,
      syncOptions: [
        'include_attachments',
        'include_threads',
        'include_deactivated_users',
        'include_bot_messages',
      ],
      userToken,
      // Defer the isMigrated flag to the end of this whole DM (see below).
      skipChannelMigratedUpdate: true,
    };

    let totalMessages = 0;
    let anyBatchFailed = false;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        const result = await processBatch(batch, migrationInput, externalSourceName, messageTs, dmLogChannelId, dmWsConfig.slackBotToken);
        totalMessages += result.messages;

        if (i < batches.length - 1) {
          if (getEnableNotifications(xyneSpaceWorkspaceId) && messageTs) {
            await postMessage({
              channelId: dmLogChannelId,
              text: `⏳ Waiting ${BATCH_DELAY_MS / 1000}s before next batch…`,
              threadTs: messageTs,
              botToken: dmBotToken,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (error) {
        anyBatchFailed = true;
        logger.error('[MigrationDM] Batch processing failed', {
          batch: `${batch.batchNumber}/${batch.totalBatches}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        if (getEnableNotifications(xyneSpaceWorkspaceId) && messageTs) {
          await postMessage({
            channelId: dmLogChannelId,
            text: `❌ Batch ${batch.batchNumber}/${batch.totalBatches} failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            threadTs: messageTs,
            botToken: dmBotToken,
          });
        }
        // Continue with next batch
      }
    }

    // Mark the channel fully migrated only if every batch succeeded. If any
    // batch failed, leave isMigrated=false so a re-run re-processes this DM.
    if (!anyBatchFailed) {
      try {
        const xyneChannel = await channelRepo.findById(xyneSpaceChannelId);
        if (xyneChannel && !(xyneChannel as any).isMigrated) {
          await channelRepo.update(xyneSpaceChannelId, { isMigrated: true });
        }
        // Replace the `now` placeholder so the DM list sorts by the real last message time, not the migration run time.
        await channelRepo.recalculateLastActivityFromMessages(xyneSpaceChannelId);
        logger.info('[MigrationDM] Channel marked fully migrated', { xyneSpaceChannelId, dmChannelId });
      } catch (err) {
        logger.warn('[MigrationDM] Failed to mark channel migrated', {
          xyneSpaceChannelId,
          error: err instanceof Error ? err.message : err,
        });
      }
    } else {
      logger.warn('[MigrationDM] Some batches failed — channel left unmarked for re-run', { xyneSpaceChannelId, dmChannelId });
    }

    if (getEnableNotifications(xyneSpaceWorkspaceId) && messageTs) {
      await postMessage({
        channelId: dmLogChannelId,
        text: `🎉 DM migration complete! Total messages migrated: ${totalMessages}`,
        threadTs: messageTs,
        botToken: dmBotToken,
      });
    }

    logger.info('[MigrationDM] DM migration completed', { totalMessages, dmChannelId, fullyMigrated: !anyBatchFailed });

    return { success: !anyBatchFailed, channelId: dmChannelId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[MigrationDM] DM migration failed', { error: errorMessage });

    // dmLogChannelId may not be set if error thrown before channel lookup.
    // Prefer the caller-supplied (sync-dm) channel so failures surface there too.
    const errLogChannel = responseChannelId || dmChannelId;
    if (messageTs && getEnableNotifications(config.defaultWorkspaceId)) {
      try {
        await postMessage({
          channelId: errLogChannel,
          threadTs: messageTs,
          text: `❌ DM migration failed: ${errorMessage}`,
          botToken: dmBotToken,
        });
      } catch (postError) {
        logger.error('[MigrationDM] postMessage failed', {
          error: postError instanceof Error ? postError.message : 'Unknown error',
        });
      }
    }

    return { success: false, error: errorMessage };
  }
}
