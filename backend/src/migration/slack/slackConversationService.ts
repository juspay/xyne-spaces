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
  messageTs: string | null | undefined,
  postingUserIds: Set<string>
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

  // Extract channel history (track posting user IDs)
  const conversationHistory = await extractChannelHistory(
    {
      channelId,
      oldest: oldestTimestamp,
      latest: latestTimestamp,
      includeThreads: syncOptions?.includes('include_threads'),
      includeAttachments: syncOptions?.includes('include_attachments'),
      includeDeactivatedUsers: syncOptions?.includes('include_deactivated_users'),
    },
    postingUserIds
  );

  if (ENABLE_NOTIFICATIONS && messageTs) {
    await postMessage({
      channelId,
      text: `✅ Batch ${batch.batchNumber}/${batch.totalBatches} extracted: ${conversationHistory.length} messages`,
      threadTs: messageTs,
    });
  }

  // Ingest if xyneSpaceChannelId is provided
  if (xyneSpaceChannelId && conversationHistory.length > 0) {
    await ingestConversationSlack({
      slackMessages: conversationHistory,
      externalSourceName,
      channelId: xyneSpaceChannelId,
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
 * Run migration with batch processing
 */
export async function runMigration(input: MigrationInput): Promise<MigrationResult> {
  logger.info('[Migration] Starting migration', {
    syncDate: input.syncDate,
    channelId: input.channelId,
  });

  try {
    // Validate input
    await validateInput(input);

    let xyneSpaceChannelLink: string | undefined;
    if (input.xyneSpaceChannelId && config.slackFrontendUrl) {
      const channelRepo = new ChannelRepository();
      const xyneChannel = await channelRepo.findById(input.xyneSpaceChannelId);
      if (xyneChannel) {
        const channelName = xyneChannel.name;
        xyneSpaceChannelLink = `<${config.slackFrontendUrl}/chat/${input.xyneSpaceChannelId}|${channelName}>`;
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

    const messageTs = ENABLE_NOTIFICATIONS
      ? await postMessage({
          channelId: input.channelId!,
          text: fallbackText,
          blocks,
        })
      : null;

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
    const channelMemberIds = await extractChannelMembers(input.channelId!);
    const postingUserIds = new Set<string>();

    // Process batches
    let totalMessages = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      try {
        const result = await processBatch(
          batch,
          input,
          externalSourceName,
          messageTs,
          postingUserIds
        );
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

    // Calculate viewers (members who never posted)
    const viewerUserIds = channelMemberIds.filter((memberId) => !postingUserIds.has(memberId));
    const userRepo = new UserRepository();
    const userCache: UserInfoCache = new Map();
    if (viewerUserIds.length > 0 && config.slackBotToken !== '') {
      for (let i = 0; i < viewerUserIds.length; i++) {
        const viewerUserId = viewerUserIds[i];
        try {
          const userInfo = await getUserInfo(viewerUserId, userCache);
          if (userInfo && (userInfo.userId || (userInfo.userEmail && userInfo.userName))) {
            let resolvedUserId = userInfo.userId;
            if (!resolvedUserId && userInfo.userEmail && userInfo.userName) {
              resolvedUserId = await findOrCreateUser(
                userInfo.userEmail,
                userInfo.userName,
                userInfo.isDeactivated ?? false,
                userRepo
              );
            }
            if (resolvedUserId) {
              const channelParticipantRepo = new ChannelParticipantRepository();
              await channelParticipantRepo.addParticipant(input.xyneSpaceChannelId!, resolvedUserId, 'MEMBER');
            }
          }
        } catch (error) {
          logger.error('[Migration] Failed to fetch viewer user info', {
            viewerUserId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
        if (i < viewerUserIds.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
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
      const xyneSpacesLink = input.xyneSpaceChannelId && config.slackFrontendUrl
        ? `<${config.slackFrontendUrl}/chat/${input.xyneSpaceChannelId}|Xyne Spaces>`
        : 'Xyne Spaces';
      await postMessage({
        channelId: input.channelId!,
        text: `<!channel> This Channel has been migrated to ${xyneSpacesLink}. Please move your conversations there only this channel will be soon archived.`,
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
    logger.error('[Migration] Migration failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
