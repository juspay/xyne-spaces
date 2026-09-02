/**
 * Conversation Service
 * Extracted common logic for creating conversations and messages
 * Used by both ConversationController and external integrations
 */

import {
  ConversationRepository,
  CreateConversationInput,
} from '@/database/repositories/conversationRepository';
import { MessageRepository, CreateMessageInput } from '@/database/repositories/messageRepository';
import {
  MessageAttachmentRepository,
  CreateMessageAttachmentInput,
} from '@/database/repositories/messageAttachmentRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { ConversationParticipantRepository } from '@/database/repositories/conversationParticipantRepository';
import { UserRepository } from '@/database/repositories/users';
import { Conversation, Message } from '@prisma/client';
import { ConversationParticipation, MessageType, AttachmentEntityType, ChannelScopeType, ChannelRole, VespaInsertionStatus, VespaOperationType } from '@xyne/shared';
import { uploadFiles, UploadedFileResult } from '@/services/fileUploadService';
import { websocketService } from './websocketService';
import { redisService } from './redisService';
import { isRegisteredBot, getBotInfo } from '@/bots/core/bot-utils';
import { config } from '@/config/env';
import { vespaQueue, vespaBackfillQueue } from '@/queues/vespaQueue';
import { messageSchema, fileSchema, SubApp, channelSchema } from '@/vespa/src/types';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { messageMetadataService } from '@/services/messageMetadataService';
import { replaceCustomEmojiShortcodesWithImg } from '@/utils/customEmojiUtils';
import { isSupportedMimeType } from '@/services/fileProcessor';
import { emitTicketCommented } from '@/automations/triggers/ticket-commented.trigger';
import {
  emitMessageReceived,
  MessageLocation,
} from '@/automations/triggers/message-received.trigger';
import { processMeetLinksFromChatMessage } from '@/services/meetLinkService';

interface UserInfo {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

/**
 * Replace custom emoji shortcodes in message content.
 * Skips replacement for FlowJSON content to avoid corrupting the
 * data-flow-json HTML attribute with unescaped quote characters.
 * Emoji shortcodes inside FlowJSON text nodes are rendered by the
 * frontend's own text-node pipeline.
 */
async function replaceEmojisInContent(content: string): Promise<string> {
  if (content.includes('data-flow-json')) return content;
  return replaceCustomEmojiShortcodesWithImg(content);
}

export function extractMentionedUserIdsFromContent(content?: string | null): string[] {
  if (!content) return [];

  const regex = /<span\b[^>]*\bdata-user-id=["']([^"']+)["'][^>]*>/g;
  const userIds: string[] = [];

  for (const match of content.matchAll(regex)) {
    const userId = match[1];
    if (userId) userIds.push(userId);
  }
  logger.info('🔍 [MENTION-EXTRACT] Extracted user IDs:', userIds);

  return [...new Set(userIds)];
}

export interface CreateConversationWithMessageParams {
  channelId: string;
  userId: string;
  content?: string;
  msgType?: MessageType;
  files?: Express.Multer.File[];
  uploadedFiles?: UploadedFileResult[]; // For pre-uploaded files (external sources)
  metadata?: Record<string, unknown>;
  messageMetadata?: Record<string, unknown>;
  isBot?: boolean;
  createdAt?: Date;
  isAddingParticipant?: boolean;
  isMarkdown?: boolean;
  pinned?: boolean;
}

export interface AddMessageToConversationParams {
  conversationId: string;
  userId: string;
  content?: string;
  msgType?: MessageType;
  files?: Express.Multer.File[];
  uploadedFiles?: UploadedFileResult[]; // For pre-uploaded files (external sources)
  metadata?: Record<string, unknown>;
  replyBroadcast?: boolean;
  lastActivityAt?: Date;
  isBot?: boolean;
  createdAt?: Date;
  isAddingParticipant?: boolean;
  isMarkdown?: boolean;
  /** Migration-only: advance participant read state to the imported reply timestamp. */
  markParticipantsRead?: boolean;
}

export interface UpdateMessageParams {
  messageId: string;
  content?: string;
  files?: Express.Multer.File[];
  uploadedFiles?: UploadedFileResult[]; // For pre-uploaded files (external sources)
  metadata?: Record<string, unknown>;
}

export class ConversationService {
  private conversationRepository: ConversationRepository;
  private conversationParticipantRepository: ConversationParticipantRepository;
  private messageRepository: MessageRepository;
  private messageAttachmentRepository: MessageAttachmentRepository;
  private channelRepository: ChannelRepository;
  private channelParticipantRepository: ChannelParticipantRepository;
  private userRepository: UserRepository;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.conversationParticipantRepository = new ConversationParticipantRepository();
    this.messageRepository = new MessageRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();
    this.channelRepository = new ChannelRepository();
    this.channelParticipantRepository = new ChannelParticipantRepository();
    this.userRepository = new UserRepository();
  }

  /**
   * Get user info - checks bot registry first, then user table
   * EXACT copy from conversationController.ts lines 34-65
   */
  async getUserInfo(userId: string): Promise<UserInfo> {
    // Check if this is a registered bot
    if (isRegisteredBot(userId)) {
      const botInfo = getBotInfo(userId);
      if (botInfo) {
        return botInfo;
      }
    }

    try {
      const user = await this.userRepository.findById(userId);
      if (user) {
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          picture: user.picture || undefined,
        };
      }
    } catch (error) {
      logger.warn(`Failed to lookup user ${userId}:`, error);
    }

    return {
      id: userId,
      name: 'User',
      email: 'user@example.com',
      picture: undefined,
    };
  }

  /**
   * Pick which Vespa producer a job goes to based on the content's age.
   * Historical content (e.g. Slack migration writes original timestamps) is routed
   * to the backfill queues so a large import never floods/starves live ingestion.
   * Live messages always have createdAt≈now, so they never hit the backfill queues.
   * Threshold is VESPA_BACKFILL_AGE_DAYS (default 365 days).
   */
  private pickVespaQueue(createdAt?: Date) {
    const ageDays = Number(process.env.VESPA_BACKFILL_AGE_DAYS ?? 365);
    const thresholdMs = ageDays * 24 * 60 * 60 * 1000;
    const isHistorical = !!createdAt && createdAt.getTime() < Date.now() - thresholdMs;
    return isHistorical ? vespaBackfillQueue : vespaQueue;
  }

  private async pushVespaJobForMessage(messageID: string, userId: string, workspaceId?: string, createdAt?: Date): Promise<void> {
    this.pickVespaQueue(createdAt)
      .addJob({
        schema: messageSchema,
        jobType: 'feed',
        docId: messageID,
        ...(workspaceId ? { workspaceId } : {}),
      })
      .catch(async (error) => {
        logger.error('Error queuing Vespa job for channel:', error);
        // Log failed insertion to Postgres for later retry
        try {
          const vespaLogs = db.vespaInsertionLogs;
          if (vespaLogs) {
            const resolvedWorkspaceId = workspaceId
              ?? (await db.message.findUnique({ where: { messageId: messageID }, select: { workspaceId: true } }))?.workspaceId;
            if (!resolvedWorkspaceId) {
              logger.error(`[ConversationService] Cannot log Vespa insertion error: no workspaceId for message ${messageID}`);
              return;
            }
            await vespaLogs.create({
              data: {
                status: 'FAILED',
                type: 'INSERT',
                entityId: messageID,
                entityType: messageSchema,
                namespace: NAMESPACE,
                errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
                errorDetails: JSON.stringify(error),
                userId: userId,
                workspaceId: resolvedWorkspaceId,
                createdAt: new Date(),
              },
            });
          }
        } catch (dbError) {
          logger.error('Failed to log Vespa insertion error to database:', dbError);
        }
      });
  }

  private async pushVespaJobForChannel(
    channelId: string,
    userId: string,
    workspaceId?: string,
  ): Promise<void> {
    vespaQueue.addJob({
      schema: channelSchema,
      jobType: 'feed',
      docId: channelId,
      ...(workspaceId ? { workspaceId } : {}),
    }).catch(async (error) => {
      logger.error(`[ConversationService] Error queuing Vespa job for channel ${channelId}:`, error);
      // Log failed insertion to Postgres for later retry
      try {
        if (db.vespaInsertionLogs) {
          const resolvedWorkspaceId = workspaceId
            ?? (await db.channel.findUnique({ where: { id: channelId }, select: { workspaceId: true } }))?.workspaceId;
          if (!resolvedWorkspaceId) {
            logger.error(`[ConversationService] Cannot log Vespa insertion error: no workspaceId for channel ${channelId}`);
            return;
          }
          await db.vespaInsertionLogs.create({
            data: {
              status: VespaInsertionStatus.FAILED,
              type: VespaOperationType.INSERT,
              entityId: channelId,
              entityType: channelSchema,
              namespace: NAMESPACE,
              errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
              errorDetails: JSON.stringify(error),
              userId,
              workspaceId: resolvedWorkspaceId,
              createdAt: new Date(),
            },
          });
        }
      } catch (dbError) {
        logger.error('[ConversationService] Failed to log Vespa channel insertion error to database:', dbError);
      }
    });
  }

  private async pushVespaJobForAttachments(
    attachments: Array<{ id: string; mimetype: string }>,
    userId: string,
    workspaceId?: string,
    createdAt?: Date
  ): Promise<void> {
    if (attachments.length === 0) return;

    // Filter only supported MIME types (PDF, DOCX, TXT, MD, etc.)
    const supportedAttachments = attachments.filter(att => isSupportedMimeType(att.mimetype));

    const queue = this.pickVespaQueue(createdAt);
    for (const attachment of supportedAttachments) {
      queue.addJob({
        schema: fileSchema,
        jobType: "feed",
        docId: attachment.id,
        app: SubApp.CHAT_ATTACHMENT,
        ...(workspaceId ? { workspaceId } : {}),
      }).catch(async (error) => {
        logger.error(`[ConversationService] Error queuing Vespa job for attachment ${attachment.id}:`, error);
        // Log failed insertion to Postgres
        try {
          if (db.vespaInsertionLogs) {
            const resolvedWorkspaceId = workspaceId
              ?? (await db.messageAttachment.findUnique({ where: { id: attachment.id }, select: { workspaceId: true } }))?.workspaceId;
            if (!resolvedWorkspaceId) {
              logger.error(`[ConversationService] Cannot log Vespa insertion error: no workspaceId for attachment ${attachment.id}`);
              return;
            }
            await db.vespaInsertionLogs.create({
              data: {
                status: "FAILED",
                type: "INSERT",
                entityId: attachment.id,
                entityType: fileSchema,
                namespace: NAMESPACE,
                errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
                errorDetails: JSON.stringify(error),
                userId: userId,
                workspaceId: resolvedWorkspaceId,
                createdAt: new Date(),
              },
            });
          }
        } catch (dbError) {
          logger.error('Failed to log Vespa insertion error to database:', dbError);
        }
      });
    }
  }

  /**
   * Create new conversation with initial message
   * EXACT extraction from conversationController.ts lines 82-179
   */
  async createConversationWithMessage(params: CreateConversationWithMessageParams) {
    const {
      channelId,
      userId,
      content,
      msgType,
      files = [],
      uploadedFiles = [],
      metadata,
      messageMetadata,
      isBot,
      isMarkdown,
      createdAt,
      isAddingParticipant = true,
      pinned,
    } = params;

    // Check if channel exists
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    // Check if user is channel participant (skip if isAddingParticipant is false)
    if (isAddingParticipant) {
      const isParticipant = await this.channelParticipantRepository.isParticipant(channelId, userId);
      if (!isParticipant && !isBot) {
        // Auto-add user as participant when they send first message
        await this.channelParticipantRepository.addParticipant(channelId, userId, ChannelRole.MEMBER);
        // Re-index channel in Vespa so permissions/memberCount reflect the new participant
        this.pushVespaJobForChannel(channelId, userId, channel?.workspaceId).catch((error) => {
          logger.error(`[ConversationService] Error pushing Vespa job for channel ${channelId} after adding participant:`, error);
        });
      }
    }

    // Handle file uploads - either from raw files or pre-uploaded files
    let processedFiles: UploadedFileResult[] = [];

    // Validate that we don't have both files and pre-uploaded files
    if (files.length > 0 && uploadedFiles.length > 0) {
      throw new Error('Cannot provide both files and uploadedFiles parameters');
    }

    if (files.length > 0) {
      // Upload new files
      try {
        let newFiles = await uploadFiles(files);
        processedFiles.push(...newFiles);
      } catch (error) {
        logger.error('File upload failed:', error);
        throw new Error('File upload failed');
      }
    } else if (uploadedFiles.length > 0) {
      // Use pre-uploaded files from external sources
      processedFiles.push(...uploadedFiles);
    }

    const messageContent = await replaceEmojisInContent(content?.trim() || '');

    // First create the message
    const messageData: CreateMessageInput = {
      conversationId: 'temp', // Will be updated after conversation creation
      senderId: userId,
      content: messageContent,
      msgType: msgType || MessageType.USER,
      hasAttachment: processedFiles.length > 0,
      metadata: {
        ...messageMetadata,
        contentFormat: isMarkdown ? 'markdown' : 'html',
      },
      ...(createdAt && { createdAt }),
    };

    // Create a placeholder conversation first
    const conversationData: CreateConversationInput = {
      channelId,
      createdBy: userId,
      initialMessageId: 'temp', // Will be updated after message creation
      metadata,
      pinned: pinned || false,
      ...(createdAt && { createdAt }),
    };

    const conversation = await this.conversationRepository.create(conversationData);

    // Update message with real conversation ID
    messageData.conversationId = conversation.conversationId;
    const message = await this.messageRepository.create(messageData);

    if (await this.userRepository.findById(userId)) {
      await this.conversationParticipantRepository.createOrUpdateConversationParticipant(
        conversation.conversationId,
        userId,
        ConversationParticipation.MENTIONED,
        channelId
      );
    }

    const mentionedUserIds = extractMentionedUserIdsFromContent(messageContent);
    for (const userId of mentionedUserIds) {
      if (await this.userRepository.findById(userId)) {
        await this.conversationParticipantRepository.createOrUpdateConversationParticipant(
          conversation.conversationId,
          userId,
          ConversationParticipation.MENTIONED,
          channelId
        );
      }
    }

    // Create attachment records if files were uploaded
    if (processedFiles.length > 0) {
      // Fetch channel to get workspaceId for attachments
      const channel = await this.channelRepository.findById(channelId);
      if (!channel?.workspaceId) {
        throw new Error(`workspaceId required: channel ${channelId} not found for attachments`);
      }
      const attachmentData: CreateMessageAttachmentInput[] = processedFiles.map((file) => ({
        entityId: message.messageId,
        entityType: AttachmentEntityType.CHAT,
        originalFilename: file.originalName,
        size: file.fileSize,
        mimetype: file.mimeType,
        url: file.fileUrl,
        thumbnailUrl: file.thumbnailUrl,
        width: file.width,
        height: file.height,
        uploadedByUserId: userId,
        createdBy: userId,
        storageProvider: config.fileStorage.provider,
        conversationId: conversation.conversationId,
        workspaceId: channel.workspaceId,
        metadata: file.metadata || {},
        ...(createdAt && { createdAt }),
      }));
      await this.messageAttachmentRepository.createMany(attachmentData);

      // Fetch created attachments from database to get their real IDs for Vespa indexing
      // This ensures we have the correct DB entries ready before triggering ingestion
      const savedAttachments = await this.messageAttachmentRepository.findByMessageId(message.messageId);

      if (savedAttachments.length > 0) {
        const attachments = savedAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
        this.pushVespaJobForAttachments(attachments, userId, channel?.workspaceId, message.createdAt).catch(error => {
          logger.error(`[ConversationService] Error pushing Vespa job for attachments in conversation ${conversation.conversationId}:`, error);
        });
      }
    }

    // Push Vespa job for message indexing
    this.pushVespaJobForMessage(message.messageId, userId, channel?.workspaceId, message.createdAt).catch((error) => {
      logger.error(
        `[ConversationService] Error pushing Vespa job for message ${message.messageId}:`,
        error
      );
    });

    // Update conversation with real initial message ID
    await this.conversationRepository.update(conversation.conversationId, {
      initialMessageId: message.messageId,
    });
    await messageMetadataService.syncInitialMessageMd(conversation.conversationId);

    if (
      !isBot &&
      message.msgType === MessageType.USER &&
      channel.workspaceId &&
      channel.scopeType === ChannelScopeType.DEFAULT
    ) {
      void processMeetLinksFromChatMessage(
        messageContent,
        channel.workspaceId,
        conversation.conversationId,
        message.messageId,
      ).catch(error => {
        logger.error('[ConversationService] Failed to process meet links from new chat conversation', {
          error: error instanceof Error ? error.message : 'Unknown error',
          conversationId: conversation.conversationId,
          messageId: message.messageId,
        });
      });
    }

    // Update channel last activity
    await this.channelRepository.updateLastActivity(channelId);

    // Get sender info
    const senderInfo = await this.getUserInfo(message.senderId);

    // Broadcast new conversation via WebSocket
    // const conversationMessage = {
    //   conversationId: conversation.conversationId,
    //   channelId,
    //   messageId: message.messageId,
    //   senderId: senderInfo.id,
    //   senderName: senderInfo.name,
    //   senderPicture: senderInfo.picture,
    //   content: message.content,
    //   msgType: message.msgType,
    //   hasAttachment: message.hasAttachment,
    //   attachments: processedFiles,
    //   createdAt: message.createdAt,
    // };

    // Real-time broadcast via WebSocket (using session method for now)
    // await websocketService.broadcastToSession(channelId, 'new_conversation', conversationMessage);

    // Also broadcast via Redis for horizontal scaling (using session method for now)
    // await redisService.broadcastMessageToSession(channelId, conversationMessage);

    // Fan out the automation `MESSAGE_RECEIVED` event for the first message in a
    // new channel conversation. Which message kinds fire is a user-configured
    // trigger condition; loops are prevented by the run chain. Fire-and-forget.
    void emitMessageReceived({
      messageId: message.messageId,
      conversationId: conversation.conversationId,
      channelId,
      msgType: message.msgType as MessageType,
      userId,
      messageLocation: MessageLocation.NEW_CONVERSATION,
    });

    return {
      conversation,
      message,
      channel,
      senderInfo,
      uploadedFiles: processedFiles,
    };
  }

  /**
   * Add message to existing conversation
   * EXACT extraction from conversationController.ts lines 383-449
   */
  async addMessageToConversation(params: AddMessageToConversationParams) {
    const {
      conversationId,
      userId,
      content,
      msgType,
      files = [],
      uploadedFiles = [],
      metadata,
      replyBroadcast = false,
      lastActivityAt,
      isBot,
      isMarkdown,
      createdAt,
      isAddingParticipant = true,
      markParticipantsRead = false,
    } = params;

    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    const channel = await this.channelRepository.findById(conversation.channelId);

    // Check if user is channel participant (skip if isAddingParticipant is false)
    if (isAddingParticipant) {
      const isParticipant = await this.channelParticipantRepository.isParticipant(
        conversation.channelId,
        userId
      );
      if (!isParticipant && !isBot) {
        // Auto-add user as participant when they reply
        await this.channelParticipantRepository.addParticipant(
          conversation.channelId,
          userId,
          ChannelRole.MEMBER
        );
        // Re-index channel in Vespa so permissions/memberCount reflect the new participant
        this.pushVespaJobForChannel(conversation.channelId, userId).catch((error) => {
          logger.error(`[ConversationService] Error pushing Vespa job for channel ${conversation.channelId} after adding participant:`, error);
        });
      }
    }

    // Handle file uploads - either from raw files or pre-uploaded files
    let processedFiles: UploadedFileResult[] = [];

    // Validate that we don't have both files and pre-uploaded files
    if (files.length > 0 && uploadedFiles.length > 0) {
      throw new Error('Cannot provide both files and uploadedFiles parameters');
    }

    if (files.length > 0) {
      // Upload new files
      try {
        let newFiles = await uploadFiles(files);
        processedFiles.push(...newFiles);
      } catch (error) {
        logger.error('File upload failed:', error);
        throw new Error('File upload failed');
      }
    } else if (uploadedFiles.length > 0) {
      // Use pre-uploaded files from external sources
      processedFiles.push(...uploadedFiles);
    }

    const messageContent = await replaceEmojisInContent(content?.trim() || '');

    // Create message
    // Generate child conversation ID if replyBroadcast is true
    const childConversationId = replyBroadcast ? uuidv4() : undefined;

    const messageData: CreateMessageInput = {
      conversationId,
      senderId: userId,
      content: messageContent,
      msgType: msgType || MessageType.USER,
      hasAttachment: processedFiles.length > 0,
      showInChannel: replyBroadcast,
      childConversationId: childConversationId,
      metadata: { ...metadata, ...(isMarkdown && { contentFormat: 'markdown' }) },
      ...(createdAt && { createdAt }),
    };

    const message = await this.messageRepository.create(messageData);
    if (await this.userRepository.findById(userId)) {
      await this.conversationParticipantRepository.createOrUpdateConversationParticipant(
        conversationId,
        userId,
        ConversationParticipation.AUTHOR,
        conversation.channelId
      );
    }

    const mentionedUserIds = extractMentionedUserIdsFromContent(messageContent);
    for (const userId of mentionedUserIds) {
      if (
        (await this.userRepository.findById(userId)) &&
        (await this.conversationParticipantRepository.findByConversationIdAndUserId(
          conversationId,
          userId
        )) != ConversationParticipation.AUTHOR
      ) {
        await this.conversationParticipantRepository.createOrUpdateConversationParticipant(
          conversationId,
          userId,
          ConversationParticipation.MENTIONED,
          conversation.channelId
        );
      }
    }

    // Create attachment records if files were uploaded
    if (processedFiles.length > 0) {
      if (!channel?.workspaceId) {
        throw new Error(`workspaceId required: channel ${conversation.channelId} not found for attachments`);
      }
      const attachmentData: CreateMessageAttachmentInput[] = processedFiles.map((file) => ({
        entityId: message.messageId,
        entityType: AttachmentEntityType.CHAT,
        originalFilename: file.originalName,
        size: file.fileSize,
        mimetype: file.mimeType,
        url: file.fileUrl,
        thumbnailUrl: file.thumbnailUrl,
        width: file.width,
        height: file.height,
        uploadedByUserId: userId,
        createdBy: userId,
        storageProvider: config.fileStorage.provider,
        conversationId: conversationId,
        workspaceId: channel.workspaceId,
        metadata: file.metadata || {},
        ...(createdAt && { createdAt }),
      }));

      await this.messageAttachmentRepository.createMany(attachmentData);

      // Fetch created attachments from database to get their real IDs for Vespa indexing
      const savedAttachments = await this.messageAttachmentRepository.findByMessageId(message.messageId);

      if (savedAttachments.length > 0) {
        const attachments = savedAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
        this.pushVespaJobForAttachments(attachments, userId, channel?.workspaceId, message.createdAt).catch(error => {
          logger.error(`[ConversationService] Error pushing Vespa job for attachments in message ${message.messageId}:`, error);
        });
      }
    }

    // Push Vespa job for message indexing
    this.pushVespaJobForMessage(message.messageId, userId, channel?.workspaceId, message.createdAt).catch((error) => {
      logger.error(
        `[ConversationService] Error pushing Vespa job for message ${message.messageId}:`,
        error
      );
    });

    if (
      !isBot &&
      message.msgType === MessageType.USER &&
      channel?.workspaceId &&
      channel.scopeType === ChannelScopeType.DEFAULT
    ) {
      void processMeetLinksFromChatMessage(
        messageContent,
        channel.workspaceId,
        conversationId,
        message.messageId,
      ).catch(error => {
        logger.error('[ConversationService] Failed to process meet links from chat reply', {
          error: error instanceof Error ? error.message : 'Unknown error',
          conversationId,
          messageId: message.messageId,
        });
      });
    }

    // Create child conversation if replyBroadcast is true (similar to mutator logic)
    if (replyBroadcast && childConversationId) {
      // Create a new conversation for this message in the channel
      await this.conversationRepository.create({
        conversationId: childConversationId,
        channelId: conversation.channelId,
        createdBy: userId,
        createdAt: message.createdAt,
        initialMessageId: message.messageId,
        parentMessageId: conversation.initialMessageId,
        pinned: false,
      });
      await messageMetadataService.syncInitialMessageMd(childConversationId);
      await messageMetadataService.syncParentMessageMd(childConversationId);
    }

    await this.conversationRepository.incrementReplyCount(
      conversationId,
      createdAt === undefined ? undefined : message.createdAt,
      markParticipantsRead,
    );
    await messageMetadataService.addReply(conversationId, userId);

    // Update reply count for previous message's child conversation if it exists
    // This matches the mutator logic - get the most recent previous message and check if it has showInChannel
    const mostRecentPrevMsg = await this.messageRepository.getMostRecentPreviousMessage(
      conversationId,
      message.createdAt
    );

    // Check if it has showInChannel and childConversationId
    if (mostRecentPrevMsg?.showInChannel && mostRecentPrevMsg.childConversationId) {
      await this.conversationRepository.update(mostRecentPrevMsg.childConversationId, {
        replyCount: 1,
      });
    }

    // Update last activity for the conversation
    if (lastActivityAt) {
      await this.conversationRepository.update(conversationId, {
        lastActivityAt: lastActivityAt,
      });
    }

    // Get sender info
    const senderInfo = await this.getUserInfo(message.senderId);

    // Broadcast message via WebSocket
    // const chatMessage = {
    //   messageId: message.messageId,
    //   conversationId: message.conversationId,
    //   channelId: conversation.channelId,
    //   senderId: senderInfo.id,
    //   senderName: senderInfo.name,
    //   senderPicture: senderInfo.picture,
    //   content: message.content,
    //   msgType: message.msgType,
    //   hasAttachment: message.hasAttachment,
    //   showInChannel: replyBroadcast,
    //   attachments: processedFiles,
    //   createdAt: message.createdAt,
    // };

    // Real-time broadcast via WebSocket (using session method for now)
    // await websocketService.broadcastToSession(conversationId, 'new_message', chatMessage);

    // Also broadcast via Redis for horizontal scaling (using session method for now)
    // await redisService.broadcastMessageToSession(conversationId, chatMessage);

    // Fan out the automation `MESSAGE_RECEIVED` event for replies. Matching by
    // location, conversation, sender, message kind, and text happens in the
    // automation worker. Failures must not fail the message write.
    void emitMessageReceived({
      messageId: message.messageId,
      conversationId,
      channelId: conversation.channelId,
      msgType: message.msgType as MessageType,
      userId,
      messageLocation: MessageLocation.THREAD_REPLY,
    });

    // Fan out the automation `TICKET_COMMENTED` event. Fire-and-forget; the
    // helper itself filters out bot/system messages and conversations not
    // tied to a ticket, so it's safe to invoke unconditionally. Failures are
    // logged inside the helper and must not fail the message write.
    void emitTicketCommented({
      messageId: message.messageId,
      conversationId,
      content: message.content ?? undefined,
      msgType: message.msgType as MessageType,
      isBot,
      userId,
      createdAt: message.createdAt,
    });

    return {
      conversation,
      message,
      senderInfo,
      uploadedFiles: processedFiles,
    };
  }

  /**
   * Update existing message with new content/attachments
   * Used for handling duplicate webhooks or message edits
   * Similar to addMessageToConversation but updates instead of creating
   */
  async updateMessageContent(params: UpdateMessageParams) {
    const { messageId, content, files = [], uploadedFiles = [], metadata } = params;

    // 1. Validate message exists
    const message = await this.messageRepository.findById(messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    // 2. Validate conversation exists
    const conversation = await this.conversationRepository.findById(message.conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${message.conversationId}`);
    }

    // Fetch channel for workspaceId (used for attachments and Vespa job routing)
    const channel = await this.channelRepository.findById(conversation.channelId);

    // 3. Handle file uploads - either from raw files or pre-uploaded files
    let processedFiles: UploadedFileResult[] = [];

    // Validate that we don't have both files and pre-uploaded files
    if (files.length > 0 && uploadedFiles.length > 0) {
      throw new Error('Cannot provide both files and uploadedFiles parameters');
    }

    if (files.length > 0) {
      // Upload new files
      try {
        let newFiles = await uploadFiles(files);
        processedFiles.push(...newFiles);
        logger.info(
          `[ConversationService] Uploaded ${processedFiles.length} files for message ${messageId}`
        );
      } catch (error) {
        logger.error(`[ConversationService] File upload failed for message ${messageId}:`, error);
        throw new Error('File upload failed');
      }
    } else if (uploadedFiles.length > 0) {
      // Use pre-uploaded files from external sources
      processedFiles.push(...uploadedFiles);
    }

    // 4. Build update data object
    interface UpdateData {
      content?: string;
      metadata?: Record<string, unknown>;
      hasAttachment?: boolean;
    }

    const updateData: UpdateData = {};

    if (content !== undefined) {
      updateData.content = await replaceEmojisInContent(content.trim());
    }

    if (metadata !== undefined) {
      const existingMetadata = (message.metadata as Record<string, unknown>) || {};
      updateData.metadata = { ...existingMetadata, ...metadata };
    }

    // 5. Handle attachment replacement if new files provided
    if (processedFiles.length > 0) {
      updateData.hasAttachment = true;

      // Delete old attachments only if we have new ones to replace them
      // This prevents losing attachments when just updating text
      logger.info(`[ConversationService] Replacing attachments for message ${messageId}`);
      await this.messageAttachmentRepository.deleteByMessageId(message.messageId);

      // Create new attachment records
      if (!channel?.workspaceId) {
        throw new Error(`workspaceId required: channel ${conversation.channelId} not found for attachments`);
      }
      const attachmentData: CreateMessageAttachmentInput[] = processedFiles.map((file) => ({
        entityId: message.messageId,
        entityType: AttachmentEntityType.CHAT,
        originalFilename: file.originalName,
        size: file.fileSize,
        mimetype: file.mimeType,
        url: file.fileUrl,
        thumbnailUrl: file.thumbnailUrl,
        width: file.width,
        height: file.height,
        uploadedByUserId: message.senderId,
        createdBy: message.senderId,
        storageProvider: config.fileStorage.provider,
        conversationId: message.conversationId,
        workspaceId: channel.workspaceId,
        metadata: file.metadata || {},
      }));
      await this.messageAttachmentRepository.createMany(attachmentData);

      // Fetch created attachments from database to get their real IDs for Vespa indexing
      const savedAttachments = await this.messageAttachmentRepository.findByMessageId(message.messageId);

      if (savedAttachments.length > 0) {
        const attachments = savedAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
        this.pushVespaJobForAttachments(attachments, message.senderId, channel?.workspaceId, message.createdAt).catch(error => {
          logger.error(`[ConversationService] Error pushing Vespa job for attachments in message ${message.messageId}:`, error);
        });
      }
      logger.info(`[ConversationService] Created ${attachmentData.length} new attachments for message ${messageId}`);
    }
    // If no new files provided, keep existing attachments (don't delete)

    // 6. Update message in database
    const updatedMessage = await this.messageRepository.update(messageId, updateData);
    logger.info(
      `[ConversationService] Updated message ${messageId} in conversation ${conversation.conversationId}`
    );

    if (conversation.initialMessageId === messageId) {
      await messageMetadataService.syncInitialMessageMd(conversation.conversationId);
    }

    // Push Vespa job for message update indexing
    this.pushVespaJobForMessage(updatedMessage.messageId, message.senderId, channel?.workspaceId, updatedMessage.createdAt).catch((error) => {
      logger.error(
        `[ConversationService] Error pushing Vespa job for message ${updatedMessage.messageId}:`,
        error
      );
    });

    // 7. Get sender info
    const senderInfo = await this.getUserInfo(message.senderId);

    // 8. Broadcast updated message via WebSocket
    const chatMessage = {
      messageId: updatedMessage.messageId,
      conversationId: updatedMessage.conversationId,
      channelId: conversation.channelId,
      senderId: senderInfo.id,
      senderName: senderInfo.name,
      senderPicture: senderInfo.picture,
      content: updatedMessage.content,
      msgType: updatedMessage.msgType,
      hasAttachment: updatedMessage.hasAttachment,
      attachments: processedFiles,
      createdAt: updatedMessage.createdAt,
    };

    logger.info(
      '[ConversationService] Broadcasting message_updated to conversation:',
      updatedMessage.conversationId,
      chatMessage
    );


    return {
      conversation,
      message: updatedMessage,
      senderInfo,
      uploadedFiles: processedFiles,
    };
  }

  /**
   * Broadcast new conversation to channel
   * EXACT extraction from conversationController.ts lines 178-200
   */
  async broadcastNewConversation(
    channelId: string,
    conversation: Conversation,
    message: Message,
    senderInfo: UserInfo,
    uploadedFiles: UploadedFileResult[]
  ): Promise<void> {
    // Build conversation message object
    const conversationMessage = {
      conversationId: conversation.conversationId,
      channelId,
      messageId: message.messageId,
      senderId: message.senderId,
      senderName: senderInfo.name,
      senderPicture: senderInfo.picture,
      content: message.content,
      msgType: message.msgType,
      hasAttachment: message.hasAttachment,
      attachments: uploadedFiles,
      createdAt: message.createdAt,
    };

    logger.info(
      '[ConversationService] Broadcasting new_conversation to channel:',
      channelId,
      conversationMessage
    );

    // Real-time broadcast via WebSocket (using session method for now)
    await websocketService.broadcastToSession(channelId, 'new_conversation', conversationMessage);

    // Also broadcast via Redis for horizontal scaling (using session method for now)
    await redisService.broadcastMessageToSession(channelId, conversationMessage);
  }

  /**
   * Broadcast new message to conversation
   * EXACT extraction from conversationController.ts lines 448-470
   */
  async broadcastNewMessage(
    conversation: Conversation,
    message: Message,
    senderInfo: UserInfo,
    uploadedFiles: UploadedFileResult[]
  ): Promise<void> {
    // Build chat message object
    const chatMessage = {
      messageId: message.messageId,
      conversationId: message.conversationId,
      channelId: conversation.channelId,
      senderId: message.senderId,
      senderName: senderInfo.name,
      senderPicture: senderInfo.picture,
      content: message.content,
      msgType: message.msgType,
      hasAttachment: message.hasAttachment,
      attachments: uploadedFiles,
      createdAt: message.createdAt,
    };

    logger.info(
      '[ConversationService] Broadcasting new_message to conversation:',
      message.conversationId,
      chatMessage
    );

    // Real-time broadcast via WebSocket (using session method for now)
    await websocketService.broadcastToSession(message.conversationId, 'new_message', chatMessage);

    // Also broadcast via Redis for horizontal scaling (using session method for now)
    await redisService.broadcastMessageToSession(message.conversationId, chatMessage);
  }
}

// Export singleton instance
export const conversationService = new ConversationService();
