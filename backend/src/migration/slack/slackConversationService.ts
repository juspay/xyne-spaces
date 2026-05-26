/**
 * Slack Migration Service
 * Handles batch processing of Slack channel migrations
 */

import { logger } from '../../utils/logger';
import { getMigrationMessageBlocks, getMigrationMessageFallbackText } from './utils/blockKit';
import { postMessage } from './utils/postMessage';
import { extractChannelHistory , UserInfoCache, getUserInfo } from './utils/extractConversation';
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

const BATCH_SIZE_DAYS = 30;
const BATCH_DELAY_MS = 60000; // 1 minute
const ENABLE_NOTIFICATIONS = config.slackMigrationNotificationsEnabled; // Controlled via SLACK_MIGRATION_NOTIFICATIONS_ENABLED env var

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
  if (ENABLE_NOTIFICATIONS && messageTs) {
    await postMessage({
      channelId: logChannelId,
      text: `🔄 Processing batch ${batch.batchNumber}/${batch.totalBatches} (${batch.startDate} to ${batch.endDate})`,
      threadTs: messageTs,
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
    ...(userToken && { token: userToken }),
  });

  if (ENABLE_NOTIFICATIONS && messageTs) {
    await postMessage({
      channelId: logChannelId,
      text: `✅ Batch ${batch.batchNumber}/${batch.totalBatches} extracted: ${conversationHistory.length} messages`,
      threadTs: messageTs,
    });
  }

  // Ingest if xyneSpaceChannelId is provided
  if (xyneSpaceChannelId && conversationHistory.length > 0) {
    if (!xyneChannel) {
      throw new Error('workspaceId is required for Slack conversation ingestion');
    }
    await ingestConversationSlack({
      slackMessages: conversationHistory,
      externalSourceName,
      channelId: xyneSpaceChannelId,
      workspaceId,
      ...(input.userToken && { userToken: input.userToken }),
    });

    if (ENABLE_NOTIFICATIONS && messageTs) {
      await postMessage({
        channelId: logChannelId,
        text: `✅ Batch ${batch.batchNumber}/${batch.totalBatches} ingested`,
        threadTs: messageTs,
      });
    }
  }

  return {
    messages: conversationHistory.length,
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
      if (ENABLE_NOTIFICATIONS && input.userId && config.slackBotToken) {
        const client = new WebClient(config.slackBotToken);
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

/**
 * Add all Slack channel members as Xyne channel participants before migration
 * First collects and validates all users, then batch adds if no failures
 * If any failures exist, posts error to Slack and throws without adding anyone
 */
export async function addChannelParticipantsBeforeMigration(
  slackChannelId: string,
  xyneChannelId: string,
  batchSync: boolean = false,
  threadTs?: string,
  logChannelId?: string
): Promise<void> {
  logChannelId = logChannelId || slackChannelId;
  logger.info('[Migration] Preparing channel participants before migration', {
    slackChannelId,
    xyneChannelId,
  });

  // Fetch channel info to get the creator
  let channelCreatorSlackId: string | undefined;
  try {
    const client = new WebClient(config.slackBotToken);
    const channelInfo = await client.conversations.info({ channel: slackChannelId });
    channelCreatorSlackId = channelInfo.channel?.creator;
    logger.info('[Migration] Channel creator fetched', { slackChannelId, channelCreatorSlackId });
  } catch (error) {
    logger.warn('[Migration] Failed to fetch channel info for creator', {
      slackChannelId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  const channelMemberIds = await extractChannelMembers(slackChannelId);
  const userRepo = new UserRepository();
  const channelRepo = new ChannelRepository();
  const userInfoCache: UserInfoCache = new Map();
  const userCache = new Map<string, { id: string; isDeactivated: boolean }>();

  const channel = await channelRepo.findById(xyneChannelId);
  const workspaceId = channel?.workspaceId ?? '';

  const usersToBeAdded: UserToAdd[] = [];
  const failedUsers: ParticipantFailure[] = [];

  // Phase 1: Collect all users to be added and identify failures
  for (let i = 0; i < channelMemberIds.length; i++) {
    const memberId = channelMemberIds[i];
    try {
      const userInfo = await getUserInfo(memberId, userInfoCache, workspaceId);
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
      logger.error('[Migration] Failed to resolve channel participant', {
        memberId,
        error: reason,
      });
      failedUsers.push({
        slackUserId: memberId,
        reason,
      });
    }

  }

  logger.info('[Migration] Channel participants validation complete', {
    xyneChannelId,
    totalMembers: channelMemberIds.length,
    validUsers: usersToBeAdded.length,
    failedUsers: failedUsers.length,
  });

  // Phase 2: If any failures exist, throw error (will be caught by runMigration's catch block)
  if (failedUsers.length > 0) {
    const failureDetails = failedUsers
      .map((f) => {
        const userInfo = f.userName || f.userEmail ? ` (${f.userName || ''}${f.userName && f.userEmail ? ' - ' : ''}${f.userEmail || ''})` : '';
        return `- ${f.slackUserId}${userInfo}: ${f.reason}`;
      })
      .join('\n');

    const errorMessage = `❌ Migration failed: ${failedUsers.length} participant(s) could not be resolved:\n${failureDetails}`;
    throw new Error(errorMessage);
  }

  // Phase 3: Batch add all participants since no failures
  if (usersToBeAdded.length > 0) {
    const channelParticipantRepo = new ChannelParticipantRepository();

    // Identify the channel creator to add as ADMIN
    const creatorUser = channelCreatorSlackId
      ? usersToBeAdded.find((u) => u.slackUserId === channelCreatorSlackId)
      : undefined;

    const memberUsers = usersToBeAdded.filter((u) => u.slackUserId !== channelCreatorSlackId);

    // Add the creator as ADMIN (handles all cases: new user, existing MEMBER, or already ADMIN)
    if (creatorUser) {
      const existingParticipant = await channelParticipantRepo.addParticipant(
        xyneChannelId,
        creatorUser.xyneUserId,
        'ADMIN'
      );
      // If the user already existed, addParticipant returns the existing record without
      // updating the role. Ensure role is ADMIN if they were previously a MEMBER.
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

    // Add remaining members as MEMBER
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
            xyneChannelId,
            batchNum,
            totalBatches,
            addedCount: result.addedCount,
            existingCount: result.existingCount,
          });
          await postMessage({
            channelId: logChannelId,
            text: `✅ Batch ${batchNum}/${totalBatches}: added ${result.addedCount} participant(s).`,
            threadTs,
          });
          if (i + BATCH_SIZE < memberUserIds.length) {
            await postMessage({
              channelId: logChannelId,
              text: `⏳ Waiting 60 seconds before next batch...`,
              threadTs,
            });
            await new Promise((resolve) => setTimeout(resolve, PARTICIPANT_BATCH_DELAY_MS));
          }
        }
      } else {
        const result = await channelParticipantRepo.addParticipantsBatch(
          xyneChannelId,
          memberUserIds,
          'MEMBER'
        );

        logger.info('[Migration] Channel participants batch added', {
          xyneChannelId,
          addedCount: result.addedCount,
          existingCount: result.existingCount,
        });
      }
    }

    // Queue Vespa re-indexing for the channel (single job for all participants)
    const allUserIds = usersToBeAdded.map((u) => u.xyneUserId);
    await pushVespaJobForChannel(xyneChannelId, allUserIds[0], workspaceId || undefined);
  }
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
  // falling back to the source channel. The final @channel announcement always
  // goes to the source channel regardless.
  const logChannelId = config.slackMigrationLogChannelId || input.channelId!;

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
        xyneSpaceChannelLink = `<https://spaces.xyne.juspay.net/${workspaceId}/chat/dir/${input.xyneSpaceChannelId}|${channelName}>`;
      }
    }

    // Post initial message to log channel
    const blocks = getMigrationMessageBlocks({
      syncDate: input.syncDate!,
      userId: input.userId,
      syncOptions: input.syncOptions,
      xyneSpaceChannelId: xyneSpaceChannelLink || input.xyneSpaceChannelId,
    });
    const fallbackText = getMigrationMessageFallbackText(input.syncDate!);

    messageTs = ENABLE_NOTIFICATIONS
      ? await postMessage({
          channelId: logChannelId,
          text: fallbackText,
          blocks,
        })
      : null;

    // Add all channel participants before migration (if target channel is specified)
    if (input.xyneSpaceChannelId) {
      if (ENABLE_NOTIFICATIONS && messageTs) {
        await postMessage({
          channelId: logChannelId,
          text: '🔄 Syncing channel participants...',
          threadTs: messageTs,
        });
      }
      await addChannelParticipantsBeforeMigration(input.channelId!, input.xyneSpaceChannelId, false, messageTs ?? undefined, logChannelId);
    }

    // Create time batches
    const batches = createTimeBatches(input.syncDate!, input.syncEndDate);

    if (ENABLE_NOTIFICATIONS && messageTs) {
      await postMessage({
        channelId: logChannelId,
        text: `🔄 Migration initiated - Processing ${batches.length} batches (${BATCH_SIZE_DAYS} days each)`,
        threadTs: messageTs,
      });
    }

    // External source name format: slackMigration-{slackChannelId}
    const externalSourceName = `slackMigration-${input.channelId}`;

    // Process batches
    let totalMessages = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      try {
        const result = await processBatch(batch, input, externalSourceName, messageTs, logChannelId);
        totalMessages += result.messages;

        // Delay between batches (except last)
        if (i < batches.length - 1) {
          if (ENABLE_NOTIFICATIONS && messageTs) {
            await postMessage({
              channelId: logChannelId,
              text: `⏳ Waiting ${BATCH_DELAY_MS / 1000} seconds before next batch...`,
              threadTs: messageTs,
            });
          }

          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (error) {
        logger.error('[Migration] Batch processing failed', {
          batch: `${batch.batchNumber}/${batch.totalBatches}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        if (ENABLE_NOTIFICATIONS && messageTs) {
          await postMessage({
            channelId: logChannelId,
            text: `❌ Batch ${batch.batchNumber}/${batch.totalBatches} failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            threadTs: messageTs,
          });
        }
        // Continue with next batch
      }
    }

    // Post final summary to log channel (threaded)
    if (ENABLE_NOTIFICATIONS && messageTs) {
      if (input.xyneSpaceChannelId) {
        await postMessage({
          channelId: logChannelId,
          text: `🎉 Migration complete!\n\nTotal messages: ${totalMessages}`,
          threadTs: messageTs,
        });
      } else {
        await postMessage({
          channelId: logChannelId,
          text: `🎉 Extraction complete!\n\nTotal messages extracted: ${totalMessages}\n⚠️ No Xyne channel selected - ingestion skipped`,
          threadTs: messageTs,
        });
      }
    }

    // Final @channel announcement always goes to the source channel
    if (ENABLE_NOTIFICATIONS && input.postChannelAnnouncement !== false) {
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
      if (config.slackMigrationFinalMessage) {
        finalMessage += `\n${config.slackMigrationFinalMessage}`;
      }
      await postMessage({
        channelId: input.channelId!,
        text: finalMessage,
      });
    }

    logger.info('[Migration] Migration completed', {
      totalBatches: batches.length,
      totalMessages,
    });

    return {
      success: true,
      channelId: input.channelId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('[Migration] Migration failed', {
      error: errorMessage,
    });

    if (messageTs && ENABLE_NOTIFICATIONS) {
      try {
        await postMessage({
          channelId: logChannelId,
          threadTs: messageTs,
          text: `❌ Migration failed: ${errorMessage}`,
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

  const logChannelId = config.slackMigrationLogChannelId || responseChannelId || dmChannelId;

  logger.info('[MigrationDM] Starting DM migration', {
    dmChannelId,
    xyneSpaceChannelId,
    effectiveSyncDate,
    userId,
  });

  let messageTs: string | null = null;

  try {
    // Validate xyneSpaceChannelId exists in DB
    const channelRepo = new ChannelRepository();
    const xyneChannel = await channelRepo.findById(xyneSpaceChannelId);
    if (!xyneChannel) {
      if (ENABLE_NOTIFICATIONS && userId && config.slackBotToken && responseChannelId) {
        const client = new WebClient(config.slackBotToken);
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
    const xyneSpaceChannelLink = `<https://spaces.xyne.juspay.net/${xyneSpaceWorkspaceId}/chat/dir/${xyneSpaceChannelId}|${channelName}>`;

    // Post thread-starter to log channel
    const blocks = getMigrationMessageBlocks({
      syncDate: effectiveSyncDate,
      userId,
      xyneSpaceChannelId: xyneSpaceChannelLink,
    });
    const fallbackText = getMigrationMessageFallbackText(effectiveSyncDate);

    messageTs = ENABLE_NOTIFICATIONS
      ? await postMessage({ channelId: logChannelId, text: fallbackText, blocks })
      : null;

    if (ENABLE_NOTIFICATIONS && messageTs) {
      await postMessage({
        channelId: logChannelId,
        text: `🔄 DM migration initiated for <#${dmChannelId}> → ${xyneSpaceChannelLink}`,
        threadTs: messageTs,
      });
    }

    // Create time batches and process
    const batches = createTimeBatches(effectiveSyncDate);

    if (ENABLE_NOTIFICATIONS && messageTs) {
      await postMessage({
        channelId: logChannelId,
        text: `🔄 Processing ${batches.length} batch(es) of ${BATCH_SIZE_DAYS} days each`,
        threadTs: messageTs,
      });
    }

    const externalSourceName = `slackMigration-${dmChannelId}`;
    const migrationInput: MigrationInput = {
      channelId: dmChannelId,
      xyneSpaceChannelId,
      syncDate: effectiveSyncDate,
      userId,
      syncOptions: [
        'include_attachments',      // include file attachments
        'include_threads',           // include thread replies (common in DMs)
        'include_deactivated_users', // preserve history from users who left
        'include_bot_messages',      // include bot messages (e.g. workflow notifications)
      ],
      userToken,      // user's personal xoxp token — required to read DM history
    };

    let totalMessages = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        const result = await processBatch(batch, migrationInput, externalSourceName, messageTs, logChannelId);
        totalMessages += result.messages;

        if (i < batches.length - 1) {
          if (ENABLE_NOTIFICATIONS && messageTs) {
            await postMessage({
              channelId: logChannelId,
              text: `⏳ Waiting ${BATCH_DELAY_MS / 1000}s before next batch…`,
              threadTs: messageTs,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (error) {
        logger.error('[MigrationDM] Batch processing failed', {
          batch: `${batch.batchNumber}/${batch.totalBatches}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        if (ENABLE_NOTIFICATIONS && messageTs) {
          await postMessage({
            channelId: logChannelId,
            text: `❌ Batch ${batch.batchNumber}/${batch.totalBatches} failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            threadTs: messageTs,
          });
        }
        // Continue with next batch
      }
    }

    if (ENABLE_NOTIFICATIONS && messageTs) {
      await postMessage({
        channelId: logChannelId,
        text: `🎉 DM migration complete! Total messages migrated: ${totalMessages}`,
        threadTs: messageTs,
      });
    }

    logger.info('[MigrationDM] DM migration completed', { totalMessages, dmChannelId });

    // Pinned messages are now handled inline during extractChannelHistory (same mechanism as /sync)

    return { success: true, channelId: dmChannelId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[MigrationDM] DM migration failed', { error: errorMessage });

    if (messageTs && ENABLE_NOTIFICATIONS) {
      try {
        await postMessage({
          channelId: logChannelId,
          threadTs: messageTs,
          text: `❌ DM migration failed: ${errorMessage}`,
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
