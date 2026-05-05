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

async function pushVespaJobForChannel(channelId: string, userId: string): Promise<void> {
  vespaQueue.addJob({
    schema: channelSchema,
    jobType: 'feed',
    docId: channelId,
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
  syncOptions?: string[];
  userId?: string;
  channelId?: string;
  xyneSpaceChannelId?: string;
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
const ENABLE_NOTIFICATIONS = true; // Control Slack postMessage calls

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
  messageTs: string | null | undefined
): Promise<BatchResult> {
  const { channelId, xyneSpaceChannelId, syncOptions } = input;

  if (!channelId) {
    throw new Error('channelId is required');
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
      channelId,
      text: `🔄 Processing batch ${batch.batchNumber}/${batch.totalBatches} (${batch.startDate} to ${batch.endDate})`,
      threadTs: messageTs,
    });
  }

  // Extract channel history
  const conversationHistory = await extractChannelHistory({
    channelId,
    oldest: oldestTimestamp,
    latest: latestTimestamp,
    includeThreads: syncOptions?.includes('include_threads'),
    includeAttachments: syncOptions?.includes('include_attachments'),
    includeDeactivatedUsers: syncOptions?.includes('include_deactivated_users'),
    includeBotMessages: syncOptions?.includes('include_bot_messages'),
  });

  if (ENABLE_NOTIFICATIONS && messageTs) {
    await postMessage({
      channelId,
      text: `✅ Batch ${batch.batchNumber}/${batch.totalBatches} extracted: ${conversationHistory.length} messages`,
      threadTs: messageTs,
    });
  }

  // Ingest if xyneSpaceChannelId is provided
  if (xyneSpaceChannelId && conversationHistory.length > 0) {
    // Get workspaceId from the channel
    const channelRepo = new ChannelRepository();
    const channel = await channelRepo.findById(xyneSpaceChannelId);
    const workspaceId = channel?.workspaceId || config.defaultWorkspaceId;
    
    if (!workspaceId) {
      throw new Error('workspaceId is required for Slack conversation ingestion');
    }
    
    await ingestConversationSlack({
      slackMessages: conversationHistory,
      externalSourceName,
      channelId: xyneSpaceChannelId,
      workspaceId,
    });

    if (ENABLE_NOTIFICATIONS && messageTs) {
      await postMessage({
        channelId,
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
  threadTs?: string
): Promise<void> {
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
      const userInfo = await getUserInfo(memberId, userInfoCache);
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
            channelId: slackChannelId,
            text: `✅ Batch ${batchNum}/${totalBatches}: added ${result.addedCount} participant(s).`,
            threadTs,
          });
          if (i + BATCH_SIZE < memberUserIds.length) {
            await postMessage({
              channelId: slackChannelId,
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
    await pushVespaJobForChannel(xyneChannelId, allUserIds[0]);
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

  try {
    // Validate input
    await validateInput(input);

    let xyneSpaceChannelLink: string | undefined;
    if (input.xyneSpaceChannelId) {
      const channelRepo = new ChannelRepository();
      const xyneChannel = await channelRepo.findById(input.xyneSpaceChannelId);
      if (xyneChannel) {
        const channelName = xyneChannel.name;
        xyneSpaceChannelLink = `<https://spaces.xyne.juspay.net/chat/${input.xyneSpaceChannelId}|${channelName}>`;
      }
    }

    // Post initial message
    const blocks = getMigrationMessageBlocks({
      syncDate: input.syncDate!,
      userId: input.userId,
      syncOptions: input.syncOptions,
      xyneSpaceChannelId: xyneSpaceChannelLink || input.xyneSpaceChannelId,
    });
    const fallbackText = getMigrationMessageFallbackText(input.syncDate!);

    messageTs = ENABLE_NOTIFICATIONS
      ? await postMessage({
          channelId: input.channelId!,
          text: fallbackText,
          blocks,
        })
      : null;

    // Add all channel participants before migration (if target channel is specified)
    if (input.xyneSpaceChannelId) {
      if (ENABLE_NOTIFICATIONS && messageTs) {
        await postMessage({
          channelId: input.channelId!,
          text: '🔄 Syncing channel participants...',
          threadTs: messageTs,
        });
      }
      await addChannelParticipantsBeforeMigration(input.channelId!, input.xyneSpaceChannelId);
    }

    // Create time batches
    const batches = createTimeBatches(input.syncDate!);

    if (ENABLE_NOTIFICATIONS && messageTs) {
      await postMessage({
        channelId: input.channelId!,
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
        const result = await processBatch(batch, input, externalSourceName, messageTs);
        totalMessages += result.messages;

        // Delay between batches (except last)
        if (i < batches.length - 1) {
          if (ENABLE_NOTIFICATIONS && messageTs) {
            await postMessage({
              channelId: input.channelId!,
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
            channelId: input.channelId!,
            text: `❌ Batch ${batch.batchNumber}/${batch.totalBatches} failed: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            threadTs: messageTs,
          });
        }
        // Continue with next batch
      }
    }

    // Post final summary
    if (ENABLE_NOTIFICATIONS && messageTs) {
      if (input.xyneSpaceChannelId) {
        await postMessage({
          channelId: input.channelId!,
          text: `🎉 Migration complete!\n\nTotal messages: ${totalMessages}`,
          threadTs: messageTs,
        });
      } else {
        await postMessage({
          channelId: input.channelId!,
          text: `🎉 Extraction complete!\n\nTotal messages extracted: ${totalMessages}\n⚠️ No Xyne channel selected - ingestion skipped`,
          threadTs: messageTs,
        });
      }
    }

    if (ENABLE_NOTIFICATIONS) {
      const xyneSpacesLink = input.xyneSpaceChannelId
        ? `<https://spaces.xyne.juspay.net/chat/${input.xyneSpaceChannelId}|Xyne Spaces>`
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
          channelId: input.channelId!,
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
