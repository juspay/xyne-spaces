/**
 * Slack Conversation Ingest Service
 * Handles bulk ingestion of Slack conversations with thread support
 */

import { logger } from '../../utils/logger';
import { UserRepository } from '../../database/repositories/users';
import { MessageRepository } from '../../database/repositories/messageRepository';
import { ExternalMessageRepository } from '../../database/repositories/externalMessageRepository';
import { ExternalSourceRepository } from '../../database/repositories/externalSourceRepository';
import { ChannelUserStatusRepository } from '../../database/repositories/channelUserStatusRepository';
import { ChannelRepository } from '../../database/repositories/channelRepository';
import { AuthProvider, MessageDirection } from '@prisma/client';
import { SlackMessage, SlackFile } from '../slack/utils/extractConversation';
import {
  ExternalAttachmentService,
  ExternalAttachment,
  DownloadedAttachment,
} from '@/services/externalAttachmentService';
import { encrypt } from '../../services/encryptionService';
import { config } from '../../config/env';
import { conversationService } from '../../services/conversationService';

// ============================================================================
// Types
// ============================================================================

export interface IngestConversationSlackInput {
  slackMessages: SlackMessage[];
  externalSourceName: string;
  channelId: string;
}

export interface IngestConversationSlackResult {
  success: boolean;
  errorDetails?: string[];
}

interface MessageIngestionResult {
  messageId: string;
  conversationId: string;
}

interface UserActivity {
  lastViewedAt: Date;
  lastViewedConversationId: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse Slack timestamp to Date object
 * Throws an error if unable to parse the timestamp
 */
export function parseSlackTimestamp(slackTs: string): Date {
  const timestamp = parseFloat(slackTs);

  if (isNaN(timestamp)) {
    throw new Error(`Invalid Slack timestamp (NaN): ${slackTs}`);
  }

  const date = new Date(timestamp * 1000);

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date from timestamp: ${slackTs} (parsed as ${timestamp})`);
  }

  return date;
}

// Helper: Find or create user (throws on failure)
export const findOrCreateUser = async (
  userEmail: string,
  userName: string,
  isDeactivated: boolean,
  userRepo: UserRepository,
  userCache?: Map<string, { id: string; isDeactivated: boolean }>
): Promise<string> => {
  if (!userEmail && !userCache) {
    throw new Error(`Missing user email for user: ${userName}`);
  }

  if (userCache && userCache.has(userEmail)) {
    return userCache.get(userEmail)!.id;
  }

  let user = await userRepo.findByEmail(userEmail);

  if (!user) {
    user = await userRepo.create({
      email: userEmail,
      name: userName,
      providerUserId: `slack-migrated-${userEmail}`,
      authProvider: AuthProvider.GOOGLE,
      status: isDeactivated ? 'INACTIVE' : 'ACTIVE',
    });
    logger.info('[IngestSlack] User created', { userId: user.id, userEmail });
  }

  if (userCache) {
    userCache.set(userEmail, { id: user.id, isDeactivated });
  }
  return user.id;
};

// ============================================================================
// Main Function
// ============================================================================

/**
 * Ingest Slack conversations into the database
 */
export async function ingestConversationSlack(
  input: IngestConversationSlackInput
): Promise<IngestConversationSlackResult> {
  const { slackMessages, externalSourceName, channelId } = input;

  logger.info('[IngestSlack] Starting ingestion', {
    externalSourceName,
    channelId,
    messageCount: slackMessages.length,
  });

  const errorDetails: string[] = [];

  try {
    // Initialize repositories
    const externalSourceRepo = new ExternalSourceRepository();
    const externalMessageRepo = new ExternalMessageRepository();
    const userRepo = new UserRepository();
    const messageRepo = new MessageRepository();
    const channelUserStatusRepo = new ChannelUserStatusRepository();
    const channelRepo = new ChannelRepository();

    // Get or create external source
    let externalSource = await externalSourceRepo.findByName(externalSourceName);

    if (!externalSource) {
      const botToken = config.slackBotToken;
      if (!botToken) {
        throw new Error('SLACK_BOT_TOKEN is not configured');
      }

      const encryptedCredentials = encrypt(JSON.stringify({ botToken }));

      externalSource = await externalSourceRepo.create({
        name: externalSourceName,
        sourceType: 'slack',
        displayName: 'Slack Migration',
        channelId,
        credentials: encryptedCredentials,
      });

      logger.info('[IngestSlack] External source created', {
        externalSourceId: externalSource.id,
      });
    }

    const externalSourceId = externalSource.id;

    // User cache and activity tracking
    const userCache = new Map<string, { id: string; isDeactivated: boolean }>();
    const userActivityMap = new Map<string, UserActivity>();

    // Helper: Download attachments (returns empty array on failure)
    const downloadAttachments = async (
      slackFiles: SlackFile[] | undefined
    ): Promise<DownloadedAttachment[]> => {
      if (!slackFiles || slackFiles.length === 0) {
        return [];
      }

      try {
        const externalAttachments: ExternalAttachment[] = slackFiles.map((file) => ({
          fileName: file.name,
          fileUrl: file.url_private,
          mimeType: file.mimetype,
          size: file.size,
        }));
        return await ExternalAttachmentService.downloadForSource(
          externalSourceName,
          externalAttachments,
          {
            maxFileSize: 500 * 1024 * 1024, // 50MB
            timeout: 200000, // 200 seconds
            scopeType: 'EXTERNAL_MESSAGE',
            scopeId: externalSourceName,
          }
        );
      } catch (error) {
        logger.error('[IngestSlack] Failed to download attachments', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return []; // Continue without attachments
      }
    };

    // Helper: Find existing conversation by thread
    const findConversationByThread = async (externalThreadId: string): Promise<string | null> => {
      const existingThreadMessage = await externalMessageRepo.findByThreadId(
        externalSourceId,
        externalThreadId
      );

      if (!existingThreadMessage) {
        return null;
      }

      const existingMessage = await messageRepo.findById(existingThreadMessage.messageId);
      return existingMessage?.conversationId || null;
    };


    // Helper: Ingest a single message (throws on failure)
    const ingestMessage = async (
      externalId: string,
      externalThreadId: string,
      content: string,
      userId?: string,
      userEmail?: string,
      userName?: string,
      isDeactivated: boolean = false,
      slackFiles?: SlackFile[],
      replyBroadcast?: boolean
    ): Promise<MessageIngestionResult> => {

      let resolvedUserId = userId;

      if (!resolvedUserId) {
        if (!userEmail || !userName) {
          throw new Error(
            `Missing user information: userId=${userId}, email=${userEmail}, name=${userName}`
          );
        }
        resolvedUserId = await findOrCreateUser(
          userEmail,
          userName,
          isDeactivated,
          userRepo,
          userCache
        );
      }

      // Parse timestamp (throws if fails)
      const createdAt = parseSlackTimestamp(externalId);

      // Download attachments (continues on failure)
      const downloadedAttachments = await downloadAttachments(slackFiles);

      // Find or create conversation
      const existingConversationId = await findConversationByThread(externalThreadId);
      const isNewConversation = !existingConversationId;

      let message;
      let conversation;
      let conversationId: string;

      if (isNewConversation) {
        // Create new conversation with message
        const result = await conversationService.createConversationWithMessage({
          channelId,
          userId: resolvedUserId,
          content,
          msgType: 'USER',
          uploadedFiles: downloadedAttachments,
          isBot: false,
          createdAt,
        });

        message = result.message;
        conversation = result.conversation;
        conversationId = conversation.conversationId;

      } else {
        // Add message to existing conversation
        conversationId = existingConversationId;

        const result = await conversationService.addMessageToConversation({
          conversationId,
          userId: resolvedUserId,
          content,
          msgType: 'USER',
          uploadedFiles: downloadedAttachments,
          replyBroadcast: replyBroadcast ?? false,
          isBot: false,
          lastActivityAt: createdAt,
          createdAt,
        });

        message = result.message;

      }

      // Create external message tracking
      await externalMessageRepo.create({
        externalSourceId,
        externalId,
        externalThreadId,
        entityId: message.messageId,
        direction: MessageDirection.INCOMING,
      });

      // Track user activity
      const existingActivity = userActivityMap.get(resolvedUserId);
      if (!existingActivity || createdAt > existingActivity.lastViewedAt) {
        userActivityMap.set(resolvedUserId, {
          lastViewedAt: createdAt,
          lastViewedConversationId: conversationId,
        });
      }

      return {
        messageId: message.messageId,
        conversationId,
      };
    };

    // Process all messages
    for (const slackMessage of slackMessages) {
      try {
        // Check for duplicate top-level message
        const existingTopLevel = await externalMessageRepo.findByExternalId(
          externalSourceId,
          slackMessage.externalId
        );

        if (existingTopLevel) {
          continue; // Skip duplicate
        }

        // Ingest top-level message (throws on failure)
        // Use userId if available, otherwise use userEmail and userName
        await ingestMessage(
          slackMessage.externalId,
          slackMessage.externalId, // externalThreadId same for top-level
          slackMessage.content,
          slackMessage.userId,
          slackMessage.userEmail,
          slackMessage.userName,
          slackMessage.isDeactivated || false,
          slackMessage.files
        );

        // Process thread replies
        if (slackMessage.replies && slackMessage.replies.length > 0) {
          for (const reply of slackMessage.replies) {
            try {
              // Check for duplicate reply
              const existingReply = await externalMessageRepo.findByExternalId(
                externalSourceId,
                reply.externalThreadId
              );

              if (existingReply) {
                continue; // Skip duplicate
              }

              // Ingest reply (throws on failure)
              // Use userId if available, otherwise use userEmail and userName
              await ingestMessage(
                reply.externalThreadId,
                slackMessage.externalId, // parent thread ID
                reply.content,
                reply.userId,
                reply.userEmail,
                reply.userName,
                reply.isDeactivated || false,
                reply.files,
                reply.showInChannel ?? false
              );
            } catch (error) {
              const errorMsg = `Failed to ingest reply ${reply.externalThreadId}: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`;
              errorDetails.push(errorMsg);
              logger.error('[IngestSlack] Reply ingestion failed', {
                replyId: reply.externalThreadId,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
              // Continue with next reply
            }
          }
        }
      } catch (error) {
        const errorMsg = `Failed to ingest message ${slackMessage.externalId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        errorDetails.push(errorMsg);
        logger.error('[IngestSlack] Message ingestion failed', {
          externalId: slackMessage.externalId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with next message
      }
    }

    // Update channelUserStatus for all users
    for (const [userId, activity] of userActivityMap.entries()) {
      try {
        await channelUserStatusRepo.upsert(channelId, userId, {
          lastViewedAt: activity.lastViewedAt,
          lastViewedConversationId: activity.lastViewedConversationId,
          isStarred: false,
          isClosed: false,
        });
      } catch (error) {
        logger.error('[IngestSlack] Failed to update channelUserStatus', {
          userId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('[IngestSlack] Ingestion completed', {
      totalMessages: slackMessages.length,
      errors: errorDetails.length,
    });

    const channel = await channelRepo.findById(channelId);
    if (channel && !(channel as any).isMigrated) {
      await channelRepo.update(channelId, { isMigrated: true });
    }

    return {
      success: errorDetails.length === 0,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    };
  } catch (error) {
    logger.error('[IngestSlack] Fatal error during ingestion', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      success: false,
      errorDetails: [`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}


