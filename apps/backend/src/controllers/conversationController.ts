import { Request, Response } from 'express';
import {
  ConversationRepository,
  CreateConversationInput,
} from '../database/repositories/conversationRepository';
import { ChannelRepository } from '../database/repositories/channelRepository';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { MessageRepository, CreateMessageInput } from '../database/repositories/messageRepository';
import {
  MessageAttachmentRepository,
  CreateMessageAttachmentInput,
} from '../database/repositories/messageAttachmentRepository';
import { ReactionRepository } from '../database/repositories/reactionRepository';
import { UserRepository } from '../database/repositories/users';
import { websocketService } from '../services/websocketService';
import { redisService } from '../services/redisService';
import { uploadFiles, UploadedFileResult } from '../services/fileUploadService';
import { Message } from '@prisma/client';
import { MessageType, AttachmentEntityType, ChannelScopeType, ChannelRole } from '@xyne/shared';
import { BotCommandParser, botProcessor, BotMessageMetadata } from '../services/bots';
import { getBotInfo, isRegisteredBot } from '../bots/core/bot-utils';
import { v4 as uuidv4 } from 'uuid';
import { SendMessageResponse, GetMessagesResponse } from '../api/types/MessageTypes';
import { config } from '../config/env';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { ChannelUserStatusRepository } from '@/database/repositories/channelUserStatusRepository';
import { messageMetadataService } from '@/services/messageMetadataService';
import { unreadService } from '../services/unreadService';
import {
  canRecommendThreadSummary,
  getOrGenerateThreadSummary,
  getCachedSummary,
  deleteCachedSummary,
  isThreadSummaryEnabledForChannel,
  consumeThreadRecommendation,
  hasPendingRecommendations,
} from '@/services/threadSummaryService';
import {
  getTwinReplyDraftById,
  deleteTwinReplyDraftById,
  type TwinReplyDraft,
} from '@/services/twinReplyDraftService';
import { MessagesSideEffectHandler } from '../zero/side-effects/tables/messages-handler';
import { vespaQueue } from '@/queues/vespaQueue';
import { messageSchema } from '@/vespa/src/types';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { replaceTicketSuggestionWithCreated } from '../utils/ticketSuggestionMarkdownGenerator';
import {
  markPulseItemAsSent as rewritePulseItemAsSent,
  updatePulseMerchant as rewritePulseMerchant,
} from '../utils/markPulseItemAsSent';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { ConversationV3Repository } from '../database/repositories/conversationV3Repository';
import { RecentConversationsRepository } from '../database/repositories/recentConversationsRepository';
import { serializeConversationV3Row } from '../serializers/conversationV3Serializer';
import { serializeRecentChannelConversations } from '../serializers/recentConversationsSerializer';
import {
  serializeConversationMessageRow,
  type SerializedConversationMessageRow,
} from '../serializers/conversationMessageSerializer';
import { getCallTicketsCreatedFromSuggestionsTotal } from '@/services/otel/suggestionMetrics';
import { processMeetLinksFromChatMessage } from '@/services/meetLinkService';
import { handleUnreadCount } from '@/zero/utils/unreadCountUtlis';
import { ensureDmConversationAuthorParticipant } from '@/utils/dmConversationParticipants';
import { ConversationParticipantRepository } from '@/database/repositories/conversationParticipantRepository';
import {
  decodeThreadListCursor,
  encodeThreadListCursor,
  type ThreadListCursor,
} from '@/utils/threadListCursor';

// Local type definitions
interface UserInfo {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

// Zod schema for validating file metadata structure
const fileMetadataSchema = z.array(
  z.object({
    fileIndex: z.number(),
    hasThumbnail: z.boolean(),
    thumbnailIndex: z.number().optional(),
    width: z.number().optional(), // Width in pixels (for images/videos)
    height: z.number().optional(), // Height in pixels (for images/videos)
    duration: z.number().optional(), // Duration in seconds (for videos)
  })
);

export class ConversationController {
  private conversationRepository: ConversationRepository;
  private channelRepository: ChannelRepository;
  private channelParticipantRepository: ChannelParticipantRepository;
  private messageRepository: MessageRepository;
  private messageAttachmentRepository: MessageAttachmentRepository;
  private reactionRepository: ReactionRepository;
  private userRepository: UserRepository;
  private channelUserStatusRespository: ChannelUserStatusRepository;
  private conversationV3Repository: ConversationV3Repository;
  private conversationParticipantRepository: ConversationParticipantRepository;
  private recentConversationsRepository: RecentConversationsRepository;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.channelRepository = new ChannelRepository();
    this.channelParticipantRepository = new ChannelParticipantRepository();
    this.messageRepository = new MessageRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();
    this.reactionRepository = new ReactionRepository();
    this.userRepository = new UserRepository();
    this.channelUserStatusRespository = new ChannelUserStatusRepository();
    this.conversationV3Repository = new ConversationV3Repository();
    this.conversationParticipantRepository = new ConversationParticipantRepository();
    this.recentConversationsRepository = new RecentConversationsRepository();
  }

  /**
   * Get a stable, explicitly paginated list of threads for the authenticated user.
   * Existing thread contents remain live through Zero; this endpoint controls only list membership
   * and initial placement.
   * GET /api/conversations/threads
   */
  getUserThreads = async (req: Request, res: Response): Promise<void> => {
    const queryResult = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(10),
        cursor: z.string().min(1).max(2048).optional(),
        sort: z.enum(['sections', 'recent']).default('sections'),
      })
      .safeParse(req.query);

    if (!queryResult.success) {
      res.status(400).json({ error: 'Invalid thread list pagination parameters' });
      return;
    }

    let cursor: ThreadListCursor | null = null;
    if (queryResult.data.cursor) {
      try {
        cursor = decodeThreadListCursor(queryResult.data.cursor);
      } catch {
        res.status(400).json({ error: 'Invalid thread list cursor' });
        return;
      }
    }

    try {
      const page = await this.conversationParticipantRepository.findUserThreadsPage(
        queryResult.data.limit,
        cursor,
        queryResult.data.sort
      );

      res.json({
        threads: page.threads,
        nextCursor: page.nextCursor ? encodeThreadListCursor(page.nextCursor) : null,
        hasMore: page.hasMore,
      });
    } catch (error) {
      logger.error('Failed to fetch user threads', { userId: req.user!.id, error });
      res.status(500).json({ error: 'Failed to fetch user threads' });
    }
  };

  /**
   * Get a single message in a conversation with attachments and nudgeCounts.
   * Mirrors one-row response shape from ZQL conversationMessage query.
   * Used for mobile background prefetch of thread message data.
   * GET /api/conversations/:conversationId/message/:messageId
   */
  getConversationMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId, messageId } = req.params;
      const userId = req.user!.id;
      if (!conversationId) {
        res.status(400).json({ error: 'Conversation ID is required' });
        return;
      }
      if (!messageId) {
        res.status(400).json({ error: 'Message ID is required' });
        return;
      }
      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const channel = await this.channelRepository.findById(conversation.channelId);
      // A missing channel must deny rather than fall through: the optional chain below
      // would read as "not PRIVATE" and skip the participant check altogether.
      if (!channel || channel.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      if (channel.visibility === 'PRIVATE') {
        const isParticipant = await this.channelParticipantRepository.isParticipant(
          conversation.channelId,
          userId
        );
        if (!isParticipant) {
          res.status(403).json({
            error: 'Access denied - not a channel participant',
            code: 'NOT_CHANNEL_PARTICIPANT',
          });
          return;
        }
      }

      const message = await this.messageRepository.findById(messageId);
      if (!message || message.conversationId !== conversationId) {
        res.status(404).json({ error: 'Message not found for this conversation' });
        return;
      }
      if (message.visibleTo !== null && message.visibleTo !== userId) {
        res.status(404).json({ error: 'Message not found for this conversation' });
        return;
      }

      const [attachments, nudgeCounts] = await Promise.all([
        message.hasAttachment
          ? db.messageAttachment.findMany({
              where: {
                entityId: message.messageId,
                entityType: AttachmentEntityType.CHAT,
                isDeleted: false,
              },
              orderBy: { createdAt: 'asc' },
            })
          : Promise.resolve([]),
        db.surfaceNudgeCount.findMany({
          where: {
            messageId: message.messageId,
            OR: [{ userId }, { channelId: { not: null } }],
          },
        }),
      ]);

      const serialized: SerializedConversationMessageRow = serializeConversationMessageRow(
        message,
        attachments,
        nudgeCounts
      );

      res.status(200).json(serialized);
    } catch (error) {
      logger.error('Error fetching conversation message:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get a conversation by message ID with its initialMessageAttachments and initialMessageNudgeCounts.
   * Mirrors the ZQL channelConversationsPaginatedV3 query response format.
   * Used for mobile background prefetch of conversation data.
   * GET /api/conversations/by-message/:messageId
   */
  getConversationByMessageId = async (req: Request, res: Response): Promise<void> => {
    try {
      const { messageId } = req.params;

      if (!messageId) {
        res.status(400).json({ error: 'Message ID is required' });
        return;
      }

      const result = await this.conversationV3Repository.getConversationByMessageId(messageId);

      if (!result) {
        res.status(404).json({ error: 'Conversation not found for this message' });
        return;
      }

      const { conversation, attachments, nudgeCounts } = result;
      const serialized = serializeConversationV3Row(conversation, attachments, nudgeCounts);

      res.status(200).json(serialized);
    } catch (error) {
      logger.error('Error fetching conversation by message ID:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getRecentVisitedConversations = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const days = config.recentVisitedConversations.lookbackDays;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const channels =
        await this.recentConversationsRepository.getRecentVisitedChannelConversations(
          userId,
          cutoff
        );

      res.status(200).json({
        days,
        channels: serializeRecentChannelConversations(channels),
      });
    } catch (error) {
      logger.error('Error fetching recent visited conversations:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // Helper method to get user info
  private async getUserInfo(userId: string): Promise<UserInfo> {
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

  private async pushVespaJobForMessage(
    messageID: string,
    userId: string,
    workspaceId: string
  ): Promise<void> {
    vespaQueue
      .addJob({
        schema: messageSchema,
        jobType: 'feed',
        docId: messageID,
        userId: userId,
        ...(workspaceId ? { workspaceId } : {}),
      })
      .catch(async (error) => {
        logger.error('Error queuing Vespa job for channel:', error);
        try {
          const vespaLogs = db.vespaInsertionLogs;
          if (vespaLogs) {
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
                createdAt: new Date(),
                workspaceId: workspaceId,
              },
            });
          }
        } catch (dbError) {
          logger.error('Failed to log Vespa insertion error to database:', dbError);
        }
      });
  }

  // POST /api/channels/{channelId}/conversations - Create new conversation (start thread) with optional file attachments
  createConversation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const {
        content,
        msgType,
        visibleTo,
        fileMetadata: fileMetadataJson,
      }: {
        content: string;
        msgType?: MessageType;
        visibleTo?: string | null;
        fileMetadata?: string;
      } = req.body;
      const reqFiles =
        (req as Express.Request & { files?: { [fieldname: string]: Express.Multer.File[] } })
          .files || {};
      const files = reqFiles['files'] || [];
      const thumbnails = reqFiles['thumbnails'] || [];
      const userId = req.user!.id;

      // Parse file metadata if present
      let fileMetadata:
        | Array<{ fileIndex: number; hasThumbnail: boolean; thumbnailIndex?: number }>
        | undefined;
      if (fileMetadataJson) {
        try {
          const parsedMetadata = JSON.parse(fileMetadataJson);
          fileMetadata = fileMetadataSchema.parse(parsedMetadata);
          logger.info('Received valid file metadata', { metadata: fileMetadata });
        } catch (error) {
          logger.error('Failed to parse or validate fileMetadata', { error });
          res.status(400).json({
            error: 'Invalid file metadata format',
            details:
              error instanceof z.ZodError
                ? error.errors
                : 'File metadata must be a valid JSON array',
          });
          return;
        }
      }

      logger.info('🎯 [CONVERSATION-API] Create conversation called:', {
        channelId,
        userId,
        contentLength: content?.length || 0,
        filesCount: files.length,
        thumbnailsCount: thumbnails.length,
        hasFileMetadata: !!fileMetadata,
        msgType,
      });
      // Validate required fields - either content or files must be present
      if ((!content || content.trim() === '') && files.length === 0) {
        res
          .status(400)
          .json({ error: 'Message content or files are required to start a conversation' });
        return;
      }

      // Check if channel exists. The repository read is ACL-scoped, so a channel in
      // another workspace already resolves to null; the explicit comparison keeps the
      // boundary stated at the route rather than inherited from the layer below.
      const channel = await this.channelRepository.findById(channelId);
      if (!channel || channel.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      // 🔒 SECURITY FIX: PREVENT AUTO-ADD TO PRIVATE CHANNELS
      const isParticipant = await this.channelParticipantRepository.isParticipant(
        channelId,
        userId
      );
      if (!isParticipant) {
        // Only auto-add for PUBLIC channels
        if (channel.visibility === 'PUBLIC') {
          await this.channelParticipantRepository.addParticipant(channelId, userId, ChannelRole.MEMBER);
        } else {
          // PRIVATE channels require explicit invitation
          res.status(403).json({
            error: 'Access denied - you must be a member of this private channel to post messages',
            code: 'NOT_CHANNEL_MEMBER',
          });
          return;
        }
      }

      // Upload files if any
      let uploadedFiles: UploadedFileResult[] = [];
      if (files.length > 0) {
        try {
          uploadedFiles = await uploadFiles(
            files,
            thumbnails.length > 0 ? thumbnails : undefined,
            fileMetadata
          );
        } catch (error) {
          logger.error('File upload failed:', error);
          // Send the actual error message to the client
          const errorMessage = error instanceof Error ? error.message : 'File upload failed';
          res.status(400).json({ error: errorMessage });
          return;
        }
      }

      // Check if this is a bot command (only for text content, not file uploads)
      if (content && content.trim() && BotCommandParser.isBotCommand(content.trim())) {
        // For bot commands in createConversation, we need to create the conversation first
        // then handle the bot command with the new conversationId

        // Create a placeholder conversation first
        const conversationData: CreateConversationInput = {
          channelId,
          createdBy: userId,
          initialMessageId: 'temp', // Will be updated after message creation
        };

        const conversation = await this.conversationRepository.create(conversationData);
        await ensureDmConversationAuthorParticipant({
          channelId,
          conversationId: conversation.conversationId,
          senderId: userId,
          scopeType: channel.scopeType as ChannelScopeType,
        });

        // Handle bot command with the new conversation ID
        await this.handleBotCommand(content.trim(), conversation.conversationId, userId, res, {
          isNewConversation: true,
          channelId,
          initialMessageId: conversation.conversationId,
        });
        return;
      }

      // First create the message
      const messageData: CreateMessageInput = {
        conversationId: 'temp', // Will be updated after conversation creation
        senderId: userId,
        content: content?.trim() || '',
        msgType: msgType || MessageType.USER,
        hasAttachment: files.length > 0,
        visibleTo: visibleTo ?? null,
      };

      // Create a placeholder conversation first
      const conversationData: CreateConversationInput = {
        channelId,
        createdBy: userId,
        initialMessageId: 'temp', // Will be updated after message creation
      };

      const conversation = await this.conversationRepository.create(conversationData);

      // Update message with real conversation ID
      messageData.conversationId = conversation.conversationId;
      const message = await this.messageRepository.create(messageData);
      await ensureDmConversationAuthorParticipant({
        channelId,
        conversationId: conversation.conversationId,
        senderId: userId,
        scopeType: channel.scopeType as ChannelScopeType,
      });

      // Create attachment records if files were uploaded
      if (uploadedFiles.length > 0) {
        logger.info(
          `fixingAttachment Creating ${uploadedFiles.length} attachment records for message ${message.messageId}`
        );
        const attachmentData: CreateMessageAttachmentInput[] = uploadedFiles.map((file) => ({
          entityId: message.messageId,
          entityType: AttachmentEntityType.CHAT,
          originalFilename: file.originalName,
          size: file.fileSize,
          mimetype: file.mimeType,
          url: file.fileUrl,
          thumbnailUrl: file.thumbnailUrl ?? undefined,
          width: file.width,
          height: file.height,
          uploadedByUserId: userId,
          createdBy: userId,
          storageProvider: config.fileStorage.provider,
          conversationId: conversation.conversationId,
          workspaceId: req.user!.workspaceId!,
          metadata: file.metadata || {},
        }));

        await this.messageAttachmentRepository.createMany(attachmentData);
      }

      // Fetch created attachments from database
      const attachments =
        uploadedFiles.length > 0
          ? await this.messageAttachmentRepository.findByMessageId(message.messageId)
          : [];

      // Push Vespa job for message indexing
      this.pushVespaJobForMessage(message.messageId, userId, req.user!.workspaceId!).catch(
        (error) => {
          logger.error(
            `[ConversationController] Error pushing Vespa job for message ${message.messageId}:`,
            error
          );
        }
      );

      // Update conversation with real initial message ID
      await this.conversationRepository.update(conversation.conversationId, {
        initialMessageId: message.messageId,
      });
      await messageMetadataService.syncInitialMessageMd(conversation.conversationId);

      if (
        message.msgType === MessageType.USER &&
        req.user?.workspaceId &&
        channel.scopeType === ChannelScopeType.DEFAULT
      ) {
        void processMeetLinksFromChatMessage(
          message.content,
          req.user.workspaceId,
          conversation.conversationId,
          message.messageId,
        ).catch((error) => {
          logger.error('[ConversationController] Failed to process meet links from new conversation', {
            error: error instanceof Error ? error.message : 'Unknown error',
            conversationId: conversation.conversationId,
            messageId: message.messageId,
          });
        });
      }

      // Update channel last activity
      await this.channelRepository.updateLastActivity(channelId);

      // Reopen for all participants when a new conversation is started.
      await this.channelUserStatusRespository.reopenForAllParticipants(channelId);

      // Get sender info
      const senderInfo = await this.getUserInfo(message.senderId);

      // Broadcast new conversation via WebSocket
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
        attachments: attachments,
        createdAt: message.createdAt,
      };

      logger.info('🚀 [CONVERSATION-CREATE] Broadcasting new_conversation event:', {
        conversationId: conversation.conversationId,
        channelId,
        messageId: message.messageId,
        senderName: senderInfo.name,
      });

      // Real-time broadcast via WebSocket (using session method for now)
      logger.info(
        '🔌 [WEBSOCKET-BROADCAST] Calling websocketService.broadcastToSession for channel:',
        channelId
      );
      await websocketService.broadcastToSession(channelId, 'new_conversation', conversationMessage);
      logger.info(
        '✅ [WEBSOCKET-BROADCAST] websocketService.broadcastToSession completed for channel:',
        channelId
      );

      logger.info(
        `fixingAttachment complete: conversation ${conversation.conversationId} with ${attachments.length} attachments`
      );
      // Also broadcast via Redis for horizontal scaling (using session method for now)
      logger.info(
        '📡 [REDIS-BROADCAST] Calling redisService.broadcastMessageToSession for channel:',
        channelId
      );
      await redisService.broadcastMessageToSession(channelId, conversationMessage);
      logger.info(
        '✅ [REDIS-BROADCAST] redisService.broadcastMessageToSession completed for channel:',
        channelId
      );

      await unreadService.markChannelAsViewed(channelId, userId, conversation.conversationId);

      // Update unread counts for participants so the badge number appears for recipients.
      const channelParticipants = await this.channelParticipantRepository.getChannelParticipants(channelId);
      await handleUnreadCount(
        channelId,
        true,
        channelParticipants.map(p => ({ userId: p.userId })),
        userId,
      );

      const handler = new MessagesSideEffectHandler({
        userID: userId,
        workspaceId: req.user!.workspaceId!,
        role: req.user!.role!,
        memberId: req.user!.memberId!,
        orgRole: req.user!.orgRole!,
      });
      handler
        .onInsert({
          entityId: message.messageId,
          entityType: 'messages',
          operation: 'insert',
        })
        .catch((err) => logger.error('Side-effect handler error: createConversation', err));

      userActivityTrackingService
        .trackMessageSent(userId, {
          messageId: message.messageId,
        })
        .catch((error) => {
          logger.error('[UserActivityTracking] Failed to track message sent activity:', {
            messageId: message.messageId,
            error: error,
          });
        });

      res.status(201).json({
        conversationId: conversation.conversationId,
        channelId: conversation.channelId,
        createdBy: conversation.createdBy,
        initialMessage: {
          messageId: message.messageId,
          content: message.content,
          msgType: message.msgType,
          hasAttachment: message.hasAttachment,
          edited: (message as Message & { edited?: boolean }).edited ?? false,
          attachments: attachments,
          createdAt: message.createdAt,
          sender: senderInfo,
        },
        replyCount: 0,
        pinned: conversation.pinned,
        createdAt: conversation.createdAt,
      });
    } catch (error) {
      logger.error('Error creating conversation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // GET /api/channels/{channelId}/conversations - Get conversations in channel
  getChannelConversations = async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const userId = req.user!.id;

      // Check if channel exists. The repository read is ACL-scoped, so a channel in
      // another workspace already resolves to null; the explicit comparison keeps the
      // boundary stated at the route rather than inherited from the layer below.
      const channel = await this.channelRepository.findById(channelId);
      if (!channel || channel.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      // 🔒 SECURITY FIX: ENFORCE PARTICIPANT CHECK
      const isParticipant = await this.channelParticipantRepository.isParticipant(
        channelId,
        userId
      );
      if (!isParticipant && channel.visibility === 'PRIVATE') {
        res.status(403).json({
          error: 'Access denied - not a channel participant',
          code: 'NOT_CHANNEL_PARTICIPANT',
        });
        return;
      }

      // Get user's last viewed conversation for this channel
      const participant = await this.channelUserStatusRespository.findParticipant(
        channelId,
        userId
      );
      const lastViewedConversationId = participant?.lastViewedConversationId || null;

      const conversations = await this.conversationRepository.getChannelConversations(channelId);

      // Collect all message IDs for bulk reaction loading
      const messageIds = conversations
        .map((conv) => conv.initialMessageId)
        .filter((id) => id !== null);

      // Load reactions for all initial messages in one call
      const reactionsData =
        messageIds.length > 0
          ? await this.reactionRepository.getMessagesReactions(messageIds, userId)
          : {};

      // Get initial message for each conversation
      const conversationsWithMessages = await Promise.all(
        conversations.map(async (conversation) => {
          try {
            const initialMessage = await this.messageRepository.findById(
              conversation.initialMessageId
            );
            const senderInfo = initialMessage
              ? await this.getUserInfo(initialMessage.senderId)
              : null;

            // Get attachments for initial message
            const attachments =
              initialMessage && initialMessage.hasAttachment
                ? await this.messageAttachmentRepository.findByMessageId(initialMessage.messageId)
                : [];

            // Get reactions for this message and map to frontend format
            const reactions = initialMessage
              ? (reactionsData[initialMessage.messageId] || []).map((r) => ({
                  emoji: r.emojiName,
                  count: r.count,
                  users: r.users,
                  reacted: r.userHasReacted,
                }))
              : [];

            return {
              conversationId: conversation.conversationId,
              channelId: conversation.channelId,
              createdBy: conversation.createdBy,
              replyCount: conversation.replyCount,
              pinned: conversation.pinned,
              lastActivityAt: conversation.lastActivityAt,
              createdAt: conversation.createdAt,
              initialMessage: initialMessage
                ? {
                    messageId: initialMessage.messageId,
                    content: initialMessage.content,
                    msgType: initialMessage.msgType,
                    hasAttachment: initialMessage.hasAttachment,
                    edited: (initialMessage as Message & { edited?: boolean }).edited ?? false,
                    attachments,
                    createdAt: initialMessage.createdAt,
                    sender: senderInfo,
                    reactions,
                  }
                : null,
            };
          } catch (error) {
            logger.error(
              `Error getting initial message for conversation ${conversation.conversationId}:`,
              error
            );
            return {
              conversationId: conversation.conversationId,
              channelId: conversation.channelId,
              createdBy: conversation.createdBy,
              replyCount: conversation.replyCount,
              pinned: conversation.pinned,
              lastActivityAt: conversation.lastActivityAt,
              createdAt: conversation.createdAt,
              initialMessage: null,
            };
          }
        })
      );

      res.status(200).json({
        channelId,
        conversations: conversationsWithMessages,
        total: conversationsWithMessages.length,
        lastViewedConversationId,
      });
    } catch (error) {
      logger.error('Error getting channel conversations:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // GET /api/conversations/{conversationId} - Get conversation details
  getConversationDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const userId = req.user!.id;

      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // 🔒 SECURITY FIX: ENFORCE PARTICIPANT CHECK
      const channel = await this.channelRepository.findById(conversation.channelId);
      if (channel && channel.visibility === 'PRIVATE') {
        const isParticipant = await this.channelParticipantRepository.isParticipant(
          conversation.channelId,
          userId
        );
        if (!isParticipant) {
          res.status(403).json({
            error: 'Access denied - not a channel participant',
            code: 'NOT_CHANNEL_PARTICIPANT',
          });
          return;
        }
      }

      // Get all messages in conversation
      const messages = await this.messageRepository.getConversationMessages(conversationId, userId);

      // Get sender info and attachments for each message
      const messagesWithSenders = await Promise.all(
        (Array.isArray(messages) ? messages : messages.data || []).map(async (message) => {
          const attachments = message.hasAttachment
            ? await this.messageAttachmentRepository.findByMessageId(message.messageId)
            : [];

          return {
            messageId: message.messageId,
            conversationId: message.conversationId,
            senderId: message.senderId,
            content: message.content,
            msgType: message.msgType,
            hasAttachment: message.hasAttachment,
            edited: (message as Message & { edited?: boolean }).edited ?? false,
            attachments: attachments.map((att) => ({
              attachmentId: att.id,
              fileName: att.originalFilename,
              fileSize: att.size,
              mimeType: att.mimetype,
              fileUrl: att.url,
              thumbnailUrl: att.thumbnailUrl,
              uploadedBy: att.uploadedByUserId,
              messageId: att.entityId,
              conversationId: att.conversationId,
              createdAt: att.createdAt,
              metadata: att.metadata,
            })),
            createdAt: message.createdAt,
            sender: await this.getUserInfo(message.senderId),
          };
        })
      );

      res.status(200).json({
        conversationId: conversation.conversationId,
        channelId: conversation.channelId,
        createdBy: conversation.createdBy,
        replyCount: conversation.replyCount,
        pinned: conversation.pinned,
        lastActivityAt: conversation.lastActivityAt,
        createdAt: conversation.createdAt,
        messages: messagesWithSenders,
        messageCount: messagesWithSenders.length,
      });
    } catch (error) {
      logger.error('Error getting conversation details:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // POST /api/conversations/{conversationId}/messages - Reply to conversation (with optional file attachments)
  replyToConversation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const {
        content,
        msgType,
        visibleTo,
        fileMetadata: fileMetadataJson,
      }: {
        content: string;
        msgType?: MessageType;
        visibleTo?: string | null;
        fileMetadata?: string;
      } = req.body;
      const reqFiles =
        (req as Express.Request & { files?: { [fieldname: string]: Express.Multer.File[] } })
          .files || {};
      const files = reqFiles['files'] || [];
      const thumbnails = reqFiles['thumbnails'] || [];
      const userId = req.user!.id;
      const showInChannel = req.body.showInChannel === true || req.body.showInChannel === 'true';

      // Parse file metadata if present
      let fileMetadata:
        | Array<{ fileIndex: number; hasThumbnail: boolean; thumbnailIndex?: number }>
        | undefined;
      if (fileMetadataJson) {
        try {
          const parsedMetadata = JSON.parse(fileMetadataJson);
          fileMetadata = fileMetadataSchema.parse(parsedMetadata);
          logger.info('Received valid file metadata', { metadata: fileMetadata });
        } catch (error) {
          logger.error('Failed to parse or validate fileMetadata', { error });
          res.status(400).json({
            error: 'Invalid file metadata format',
            details:
              error instanceof z.ZodError
                ? error.errors
                : 'File metadata must be a valid JSON array',
          });
          return;
        }
      }

      if (files.length > 0) {
        logger.info('🎯 [CONVERSATION-API] Reply with files:', {
          conversationId,
          userId,
          filesCount: files.length,
          thumbnailsCount: thumbnails.length,
          hasFileMetadata: !!fileMetadata,
        });
      }

      // Validate required fields - either content or files must be present
      if ((!content || content.trim() === '') && files.length === 0) {
        res.status(400).json({ error: 'Message content or files are required' });
        return;
      }

      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // 🔒 SECURITY FIX: PREVENT AUTO-ADD TO PRIVATE CHANNELS
      // Fetch channel once for reuse throughout function
      const channel = await this.channelRepository.findById(conversation.channelId);
      const isParticipant = await this.channelParticipantRepository.isParticipant(
        conversation.channelId,
        userId
      );
      if (!isParticipant) {
        // Only auto-add for PUBLIC channels
        if (channel && channel.visibility === 'PUBLIC') {
          await this.channelParticipantRepository.addParticipant(
            conversation.channelId,
            userId,
            ChannelRole.MEMBER
          );
        } else {
          // PRIVATE channels require explicit invitation
          res.status(403).json({
            error: 'Access denied - you must be a member of this private channel to reply',
            code: 'NOT_CHANNEL_MEMBER',
          });
          return;
        }
      }

      // Upload files if any
      let uploadedFiles: UploadedFileResult[] = [];
      if (files.length > 0) {
        try {
          uploadedFiles = await uploadFiles(
            files,
            thumbnails.length > 0 ? thumbnails : undefined,
            fileMetadata
          );
        } catch (error) {
          logger.error('File upload failed:', error);
          // Send the actual error message to the client
          const errorMessage = error instanceof Error ? error.message : 'File upload failed';
          res.status(400).json({ error: errorMessage });
          return;
        }
      }

      // Check if this is a bot command (only for text content, not file uploads)
      if (content && content.trim() && BotCommandParser.isBotCommand(content.trim())) {
        await this.handleBotCommand(content.trim(), conversationId, userId, res);
        return;
      }

      // Generate child conversation ID if showInChannel is true
      const childConversationId = showInChannel ? uuidv4() : undefined;

      // Create message
      const messageData: CreateMessageInput = {
        conversationId,
        senderId: userId,
        content: content?.trim() || '',
        msgType: msgType || MessageType.USER,
        hasAttachment: files.length > 0,
        showInChannel: showInChannel,
        childConversationId: childConversationId,
        visibleTo: visibleTo ?? null,
      };

      const message = await this.messageRepository.create(messageData);

      // Create attachment records if files were uploaded
      if (uploadedFiles.length > 0) {
        const attachmentData: CreateMessageAttachmentInput[] = uploadedFiles.map((file) => ({
          entityId: message.messageId,
          entityType: AttachmentEntityType.CHAT,
          originalFilename: file.originalName,
          size: file.fileSize,
          mimetype: file.mimeType,
          url: file.fileUrl,
          thumbnailUrl: file.thumbnailUrl ?? undefined,
          width: file.width,
          height: file.height,
          uploadedByUserId: userId,
          createdBy: userId,
          storageProvider: config.fileStorage.provider,
          conversationId: conversationId,
          workspaceId: req.user!.workspaceId!,
          metadata: file.metadata || {},
        }));

        await this.messageAttachmentRepository.createMany(attachmentData);
      }

      // Fetch created attachments from database
      const attachments =
        uploadedFiles.length > 0
          ? await this.messageAttachmentRepository.findByMessageId(message.messageId)
          : [];

      // Push Vespa job for message indexing
      this.pushVespaJobForMessage(message.messageId, userId, req.user!.workspaceId!).catch(
        (error) => {
          logger.error(
            `[ConversationController] Error pushing Vespa job for message ${message.messageId}:`,
            error
          );
        }
      );

      // Create child conversation if showInChannel is true (similar to mutator logic)
      if (showInChannel && childConversationId) {
        // Create a new conversation for this message in the channel
        await this.conversationRepository.create({
          conversationId: childConversationId,
          channelId: conversation.channelId,
          createdBy: userId,
          initialMessageId: message.messageId,
          parentMessageId: conversation.initialMessageId,
          pinned: false,
        });
        await messageMetadataService.syncInitialMessageMd(childConversationId);
        await messageMetadataService.syncParentMessageMd(childConversationId);

        logger.info(
          `📤 [SEND-TO-CHANNEL] Created child conversation ${childConversationId} for message ${message.messageId}`
        );
      }

      // Update conversation reply count and last activity
      await this.conversationRepository.incrementReplyCount(conversationId);

      if (
        message.msgType === MessageType.USER &&
        req.user?.workspaceId &&
        channel?.scopeType === ChannelScopeType.DEFAULT
      ) {
        void processMeetLinksFromChatMessage(
          message.content,
          req.user.workspaceId,
          conversationId,
          message.messageId,
        ).catch((error) => {
          logger.error('[ConversationController] Failed to process meet links from reply', {
            error: error instanceof Error ? error.message : 'Unknown error',
            conversationId,
            messageId: message.messageId,
          });
        });
      }

      // Update reply count for previous message's child conversation if it exists
      // This matches the mutator logic - get the most recent previous message (limit 1) and check if it has showInChannel
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

      // Get sender info
      const senderInfo = await this.getUserInfo(message.senderId);

      // Broadcast message via WebSocket
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
        attachments: attachments,
        createdAt: message.createdAt,
      };

      // Real-time broadcast via WebSocket (using session method for now)
      await websocketService.broadcastToSession(conversationId, 'new_message', chatMessage);

      // Also broadcast via Redis for horizontal scaling (using session method for now)
      await redisService.broadcastMessageToSession(conversationId, chatMessage);

      const handler = new MessagesSideEffectHandler({
        userID: userId,
        workspaceId: req.user!.workspaceId!,
        role: req.user!.role!,
        memberId: req.user!.memberId!,
        orgRole: req.user!.orgRole!,
      });
      handler
        .onInsert({
          entityId: message.messageId,
          entityType: 'messages',
          operation: 'insert',
        })
        .catch((err) => logger.error('Side-effect handler error: replyToConversation', err));

      const response: SendMessageResponse = {
        messageId: message.messageId,
        conversationId: message.conversationId,
        content: message.content,
        msgType: message.msgType,
        hasAttachment: message.hasAttachment,
        edited: (message as Message & { edited?: boolean }).edited ?? false,
        attachments: attachments.map((att) => ({
          attachmentId: att.id,
          fileName: att.originalFilename,
          fileSize: att.size,
          mimeType: att.mimetype,
          fileUrl: att.url,
          thumbnailUrl: att.thumbnailUrl,
          uploadedBy: att.uploadedByUserId,
          messageId: att.entityId,
          conversationId: att.conversationId,
          createdAt: att.createdAt,
          metadata: att.metadata,
        })),
        createdAt: message.createdAt,
        sender: senderInfo,
      };

      res.status(201).json(response);
    } catch (error) {
      logger.error('Error replying to conversation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // PUT /api/conversations/{conversationId}/pin - Toggle conversation pin
  toggleConversationPin = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const userId = req.user!.id;

      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // 🔒 SECURITY FIX: ENFORCE PIN/UNPIN AUTHORIZATION
      const participation = await this.channelParticipantRepository.findParticipant(
        conversation.channelId,
        userId
      );
      if (!participation) {
        res.status(403).json({
          error: 'Access denied - not a channel participant',
          code: 'NOT_CHANNEL_PARTICIPANT',
        });
        return;
      }

      // Only channel admins or conversation creator can pin/unpin
      if (participation.role !== 'ADMIN' && conversation.createdBy !== userId) {
        res.status(403).json({
          error: 'Access denied - only channel admins or conversation creator can pin/unpin',
          code: 'INSUFFICIENT_PERMISSIONS',
        });
        return;
      }

      const updatedConversation = await this.conversationRepository.togglePin(conversationId);

      res.status(200).json({
        conversationId: updatedConversation.conversationId,
        pinned: updatedConversation.pinned,
        message: updatedConversation.pinned ? 'Conversation pinned' : 'Conversation unpinned',
      });
    } catch (error) {
      logger.error('Error toggling conversation pin:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // GET /api/conversations/{conversationId}/messages - Get conversation messages with pagination
  getConversationMessages = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const { page, limit, before } = req.query;
      const userId = req.user!.id;

      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // 🔒 SECURITY FIX: ENFORCE PARTICIPANT CHECK
      const channel = await this.channelRepository.findById(conversation.channelId);
      if (channel && channel.visibility === 'PRIVATE') {
        const isParticipant = await this.channelParticipantRepository.isParticipant(
          conversation.channelId,
          userId
        );
        if (!isParticipant) {
          res.status(403).json({
            error: 'Access denied - not a channel participant',
            code: 'NOT_CHANNEL_PARTICIPANT',
          });
          return;
        }
      }

      // Parse pagination parameters
      const pageNum = page ? parseInt(page as string) : undefined;
      const pageSize = limit ? parseInt(limit as string) : 50;
      const beforeDate = before ? new Date(before as string) : undefined;

      // Get messages with pagination if specified
      const messagesResult = await this.messageRepository.getConversationMessages(
        conversationId,
        userId,
        pageNum && pageSize
          ? {
              page: pageNum,
              pageSize,
              before: beforeDate,
            }
          : undefined
      );

      const messagesData = Array.isArray(messagesResult) ? messagesResult : messagesResult.data;

      // Get sender info and attachments for each message
      const messagesWithSenders = await Promise.all(
        messagesData.map(async (message: Message) => {
          const attachments = message.hasAttachment
            ? await this.messageAttachmentRepository.findByMessageId(message.messageId)
            : [];

          return {
            messageId: message.messageId,
            conversationId: message.conversationId,
            senderId: message.senderId,
            content: message.content,
            msgType: message.msgType,
            hasAttachment: message.hasAttachment,
            edited: (message as Message & { edited?: boolean }).edited ?? false,
            attachments: attachments.map((att) => ({
              attachmentId: att.id,
              fileName: att.originalFilename,
              fileSize: att.size,
              mimeType: att.mimetype,
              fileUrl: att.url,
              thumbnailUrl: att.thumbnailUrl,
              uploadedBy: att.uploadedByUserId,
              messageId: att.entityId,
              conversationId: att.conversationId,
              createdAt: att.createdAt,
              metadata: att.metadata,
            })),
            createdAt: message.createdAt,
            sender: await this.getUserInfo(message.senderId),
          };
        })
      );

      const response: GetMessagesResponse = {
        messages: messagesWithSenders,
        pagination: Array.isArray(messagesResult) ? undefined : messagesResult.pagination,
        total: messagesWithSenders.length,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error getting conversation messages:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  private async handleBotCommand(
    content: string,
    conversationId: string,
    userId: string,
    res: Response,
    options?: {
      isNewConversation?: boolean;
      channelId?: string;
      initialMessageId?: string;
    }
  ): Promise<void> {
    try {
      // Parse and validate bot command
      const parseResult = await BotCommandParser.parseAndValidate(content);

      if ('error' in parseResult) {
        // Get bot name for sender ID, fallback to bot-system
        const botName = BotCommandParser.extractBotName(content);
        const senderId = botName || 'bot-system';

        // Use FlowJson error if available, otherwise create simple error
        let errorContent: string;
        if (parseResult.errorFlowJson) {
          errorContent = parseResult.errorFlowJson;
        } else {
          const errorData = {
            error: parseResult.error,
            botName: botName || 'bot-system',
            messageType: 'error',
          };
          errorContent = JSON.stringify(errorData);
        }

        const errorMessage = await this.messageRepository.create({
          conversationId,
          senderId,
          content: errorContent,
          msgType: MessageType.BOT,
        });

        // Broadcast error message
        const senderInfo = await this.getUserInfo(userId);
        const chatMessage = {
          messageId: errorMessage.messageId,
          conversationId: errorMessage.conversationId,
          senderId: senderInfo.id,
          senderName: senderInfo.name,
          senderPicture: senderInfo.picture,
          content: errorContent, // Always stringified JSON
          msgType: errorMessage.msgType,
          createdAt: errorMessage.createdAt,
        };

        if (options?.isNewConversation && options.channelId) {
          // Update conversation with initial message ID
          await this.conversationRepository.update(conversationId, {
            initialMessageId: errorMessage.messageId,
          });
          await messageMetadataService.syncInitialMessageMd(conversationId);
          await this.channelRepository.updateLastActivity(options.channelId);

          // Broadcast as new conversation
          const conversationMessage = { ...chatMessage, channelId: options.channelId };
          await websocketService.broadcastToSession(
            options.channelId,
            'new_conversation',
            conversationMessage
          );
          await redisService.broadcastSessionEvent(options.channelId, {
            type: 'session_created',
            sessionId: conversationId,
            data: conversationMessage,
          });
        } else {
          // Broadcast as regular message
          await websocketService.broadcastToSession(conversationId, 'new_message', chatMessage);
          await redisService.broadcastMessageToSession(conversationId, chatMessage);
        }

        res.status(400).json({
          error: parseResult.error,
          messageId: errorMessage.messageId,
        });
        return;
      }

      // Create trigger message with execution ID
      const executionId = uuidv4();

      // Extract large description from validated input if present
      let largeDescription: string | undefined;
      let simplifiedInput = parseResult.validatedInput;

      if (
        parseResult.validatedInput.description &&
        parseResult.validatedInput.description.length > 10000
      ) {
        logger.info(
          `🔍 [BOT-CMD] Large description detected (${parseResult.validatedInput.description.length} chars), extracting...`
        );
        largeDescription = parseResult.validatedInput.description;
        // Create simplified input without the large description for storage
        simplifiedInput = {
          ...parseResult.validatedInput,
          description: '[Large description - will be passed to bot]',
        };
      }

      const triggerMetadata: BotMessageMetadata = {
        botExecutionId: executionId,
        botName: parseResult.botName,
        messageType: 'trigger',
        data: simplifiedInput, // Use simplified input for metadata
      };

      // Create simplified command for storage (without huge description)
      let storedContent = content;
      if (largeDescription) {
        // Rebuild command without description parameter for storage
        const commandParts = content.split('--description');
        if (commandParts.length > 1) {
          // Remove description parameter from stored content
          storedContent = commandParts[0].trim();
          logger.info(
            `✂️ [BOT-CMD] Simplified stored content: ${storedContent.substring(0, 100)}...`
          );
        }
      }

      // Store simplified trigger message
      const triggerMessage = await this.messageRepository.createWithExecutionId(
        {
          conversationId,
          senderId: userId,
          content: storedContent, // Use simplified content
          msgType: MessageType.USER,
          metadata: triggerMetadata,
        },
        executionId
      );

      // Queue bot execution with full validated input (including large description)
      const queued = await botProcessor.queueBotExecution({
        executionId,
        conversationId,
        botName: parseResult.botName,
        input: parseResult.validatedInput, // Use original validated input with full description
        userId,
      });

      if (!queued) {
        throw new Error('Failed to queue bot execution');
      }

      // Broadcast trigger message
      const senderInfo = await this.getUserInfo(userId);
      const chatMessage = {
        messageId: triggerMessage.messageId,
        conversationId: triggerMessage.conversationId,
        senderId: senderInfo.id,
        senderName: senderInfo.name,
        senderPicture: senderInfo.picture,
        content: triggerMessage.content,
        msgType: triggerMessage.msgType,
        createdAt: triggerMessage.createdAt,
      };

      if (options?.isNewConversation && options.channelId) {
        // Update conversation with initial message ID
        await this.conversationRepository.update(conversationId, {
          initialMessageId: triggerMessage.messageId,
        });
        await messageMetadataService.syncInitialMessageMd(conversationId);
        await this.channelRepository.updateLastActivity(options.channelId);

        // Broadcast as new conversation
        const conversationMessage = { ...chatMessage, channelId: options.channelId };
        await websocketService.broadcastToSession(
          options.channelId,
          'new_conversation',
          conversationMessage
        );
        await redisService.broadcastSessionEvent(options.channelId, {
          type: 'session_created',
          sessionId: conversationId,
          data: conversationMessage,
        });

        res.status(201).json({
          conversationId,
          channelId: options.channelId,
          messageId: triggerMessage.messageId,
          content: triggerMessage.content,
          msgType: triggerMessage.msgType,
          createdAt: triggerMessage.createdAt,
          sender: senderInfo,
          botExecution: {
            executionId,
            botName: parseResult.botName,
            queued: true,
          },
        });
      } else {
        // Broadcast as regular message
        await websocketService.broadcastToSession(conversationId, 'new_message', chatMessage);
        await redisService.broadcastMessageToSession(conversationId, chatMessage);

        res.status(201).json({
          messageId: triggerMessage.messageId,
          conversationId: triggerMessage.conversationId,
          content: triggerMessage.content,
          msgType: triggerMessage.msgType,
          createdAt: triggerMessage.createdAt,
          sender: senderInfo,
          botExecution: {
            executionId,
            botName: parseResult.botName,
            queued: true,
          },
        });
      }
    } catch (error) {
      logger.error('Error handling bot command:', error);
      res.status(500).json({ error: 'Failed to process bot command' });
    }
  }

  // PUT /api/conversations/{conversationId}/messages/{messageId} - Update a message
  updateMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId, messageId } = req.params;
      const { content }: { content: string } = req.body;
      const userId = req.user!.id;

      logger.info('🔄 [MESSAGE-UPDATE] Update message called:', {
        conversationId,
        messageId,
        userId,
        contentLength: content?.length || 0,
      });

      // Validate required fields
      if (!content || content.trim() === '') {
        res.status(400).json({ error: 'Message content is required' });
        return;
      }

      // Check if conversation exists
      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // Check if message exists
      const message = await this.messageRepository.findById(messageId);
      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      // Verify message belongs to conversation
      if (message.conversationId !== conversationId) {
        res.status(400).json({ error: 'Message does not belong to this conversation' });
        return;
      }

      // Verify user is the sender (only sender can edit their own messages)
      if (message.senderId !== userId) {
        res.status(403).json({ error: 'You can only edit your own messages' });
        return;
      }

      // Don't allow editing bot messages
      if (message.msgType === MessageType.BOT) {
        res.status(403).json({ error: 'Bot messages cannot be edited' });
        return;
      }

      // Update message and set edited flag
      const updatedMessage = await this.messageRepository.update(messageId, {
        content: content.trim(),
        edited: true,
      });

      // Get sender info
      const senderInfo = await this.getUserInfo(updatedMessage.senderId);

      // Get attachments
      const attachments = updatedMessage.hasAttachment
        ? await this.messageAttachmentRepository.findByMessageId(updatedMessage.messageId)
        : [];

      // Broadcast message update via WebSocket
      const chatMessage = {
        messageId: updatedMessage.messageId,
        conversationId: updatedMessage.conversationId,
        channelId: conversation.channelId,
        senderId: updatedMessage.senderId,
        senderName: senderInfo.name,
        senderPicture: senderInfo.picture,
        content: updatedMessage.content,
        msgType: updatedMessage.msgType,
        hasAttachment: updatedMessage.hasAttachment,
        edited: (updatedMessage as Message & { edited?: boolean }).edited ?? false,
        attachments,
        createdAt: message.createdAt,
      };

      logger.info('🚀 [MESSAGE-UPDATE] Broadcasting message_updated event:', {
        conversationId,
        messageId,
        channelId: conversation.channelId,
      });

      // Real-time broadcast via WebSocket
      await websocketService.broadcastToSession(conversationId, 'message_updated', chatMessage);

      // Also broadcast via Redis for horizontal scaling
      await redisService.broadcastMessageToSession(conversationId, chatMessage);

      // Push Vespa job for message indexing
      this.pushVespaJobForMessage(message.messageId, userId, req.user!.workspaceId!).catch(
        (error) => {
          logger.error(
            `[ConversationController] Error pushing Vespa job for message ${message.messageId}:`,
            error
          );
        }
      );

      res.status(200).json({
        messageId: updatedMessage.messageId,
        conversationId: updatedMessage.conversationId,
        content: updatedMessage.content,
        msgType: updatedMessage.msgType,
        hasAttachment: updatedMessage.hasAttachment,
        edited: (updatedMessage as Message & { edited?: boolean }).edited ?? false,
        attachments,
        createdAt: updatedMessage.createdAt,
        sender: senderInfo,
      });
    } catch (error) {
      logger.error('Error updating message:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // PUT /api/conversations/{conversationId}/messages/{messageId}/ticket-suggestion
  // Update ticket suggestion block to ticket-created block
  updateTicketSuggestion = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId, messageId } = req.params;
      const { suggestionId, ticketId, xyneId, title, ticketConversationId } = req.body;
      const userId = req.user!.id;
      // Validate required fields
      if (!suggestionId || !ticketId || !xyneId || !title || !ticketConversationId) {
        res.status(400).json({
          error: 'suggestionId, ticketId, xyneId, title, and ticketConversationId are required',
        });
        return;
      }

      // Check if message exists
      const message = await this.messageRepository.findById(messageId);
      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      // Verify message belongs to conversation
      if (message.conversationId !== conversationId) {
        res.status(400).json({ error: 'Message does not belong to this conversation' });
        return;
      }

      // Verify this is a bot message with ticket suggestions
      if (message.msgType !== MessageType.BOT) {
        res.status(400).json({ error: 'Only bot messages with ticket suggestions can be updated' });
        return;
      }

      const metadata = message.metadata as Record<string, any>;
      if (!metadata?.hasSuggestedTickets) {
        res.status(400).json({ error: 'Message does not contain ticket suggestions' });
        return;
      }

      // Get user info for createdBy field
      const userInfo = await this.getUserInfo(userId);

      // Replace ticket-suggestion block with ticket-created block (using suggestionId for identification)
      const updatedContent = replaceTicketSuggestionWithCreated(
        message.content,
        suggestionId, // Use UUID to find the suggestion
        {
          ticketId,
          xyneId,
          title,
          conversationId: ticketConversationId,
          createdBy: userInfo.email,
          createdAt: new Date().toISOString(),
        }
      );

      // Update message content and set edited flag
      const updatedMessage = await this.messageRepository.update(messageId, {
        content: updatedContent,
        edited: true,
      });

      getCallTicketsCreatedFromSuggestionsTotal().add(1, { workspaceId: req.user!.workspaceId! });

      // Get conversation for channelId
      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      res.status(200).json({
        messageId: updatedMessage.messageId,
        conversationId: updatedMessage.conversationId,
        content: updatedMessage.content,
        edited: true,
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // PUT /api/conversations/{conversationId}/messages/{messageId}/pulse-item
  // Mark a Pulse actionable item as sent (moves it from pulseItems → pulseSent in frontmatter)
  markPulseItemAsSent = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId, messageId } = req.params;
      const { itemId } = req.body as { itemId: string };

      if (!itemId) {
        res.status(400).json({ error: 'itemId is required' });
        return;
      }

      const message = await this.messageRepository.findById(messageId);
      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      if (message.conversationId !== conversationId) {
        res.status(400).json({ error: 'Message does not belong to this conversation' });
        return;
      }

      if (message.msgType !== MessageType.BOT) {
        res.status(400).json({ error: 'Only bot Pulse messages can be updated' });
        return;
      }

      const metadata = message.metadata as Record<string, unknown>;
      if (metadata?.['messageSubtype'] !== 'pulse_actionables') {
        res.status(400).json({ error: 'Message is not a Pulse actionables message' });
        return;
      }

      // Rewrite frontmatter to mark this item as sent
      const updatedContent = rewritePulseItemAsSent(
        message.content,
        itemId,
        new Date().toISOString()
      );

      const updatedMessage = await this.messageRepository.update(messageId, {
        content: updatedContent,
        edited: true,
      });

      res.status(200).json({
        messageId: updatedMessage.messageId,
        conversationId: updatedMessage.conversationId,
        content: updatedMessage.content,
        edited: true,
      });
    } catch (error) {
      logger.error('Error marking Pulse item as sent:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // PUT /api/conversations/{conversationId}/messages/{messageId}/pulse-merchant
  // Update a merchant entry in a Pulse actionables message's YAML frontmatter
  updatePulseMerchant = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId, messageId } = req.params;
      const {
        merchantId: localMerchantId,
        orgId,
        orgName,
      } = req.body as {
        merchantId: string; // local frontmatter id, e.g. "m1"
        orgId: string;
        orgName: string;
      };

      if (!localMerchantId || !orgId || !orgName) {
        res.status(400).json({ error: 'merchantId, orgId, and orgName are required' });
        return;
      }

      const message = await this.messageRepository.findById(messageId);
      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      if (message.conversationId !== conversationId) {
        res.status(400).json({ error: 'Message does not belong to this conversation' });
        return;
      }

      if (message.msgType !== MessageType.BOT) {
        res.status(400).json({ error: 'Only bot Pulse messages can be updated' });
        return;
      }

      const metadata = message.metadata as Record<string, unknown>;
      if (metadata?.['messageSubtype'] !== 'pulse_actionables') {
        res.status(400).json({ error: 'Message is not a Pulse actionables message' });
        return;
      }

      // Resolve merchantId and productId from the Pulse org API
      const { pulseService } = await import('@/services/pulseService');
      const orgList = await pulseService.fetchOrgList();
      const matchedOrg = orgList.find((o) => (o.id ?? o.orgId) === orgId);

      const pulseMerchantIds = matchedOrg?.merchantIdList ?? matchedOrg?.merchantIds ?? [];
      const pulseMerchantId = pulseMerchantIds.length > 0 ? pulseMerchantIds[0] : null;

      // Fetch product/lead data for this org
      const products = await pulseService.fetchOrgLeadData(orgId);
      const productId =
        products.length > 0 ? (products[0].id ?? (products[0] as any).productId ?? null) : null;

      const updatedContent = rewritePulseMerchant(message.content, localMerchantId, {
        name: orgName,
        orgId,
        merchantId: pulseMerchantId,
        productId,
      });

      const updatedMessage = await this.messageRepository.update(messageId, {
        content: updatedContent,
        edited: true,
      });

      res.status(200).json({
        success: true,
        messageId: updatedMessage.messageId,
        conversationId: updatedMessage.conversationId,
      });
    } catch (error) {
      logger.error('Error updating Pulse merchant:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Clear every in-flight agent-progress signal for a conversation and broadcast
   * `done` to all subscribers, so the "agent working" pill / Stop button disappears
   * immediately and in sync across every open view of the thread.
   *
   * The Assistant spinner's `done` is otherwise only emitted when the orchestrator
   * stream finishes naturally (mutators.ts `broadcastBotProgress` finally block), so
   * a cancel must drive this itself — the upstream run can take seconds to unwind.
   * Keyed by agentUserId (the Redis hash field), reusing each stored payload so the
   * client computes the same key and drops the matching entry.
   */
  private clearConversationAgentProgress = async (conversationId: string): Promise<void> => {
    try {
      const conversation = await this.conversationRepository.findById(conversationId);
      const channelId = conversation?.channelId;
      if (!channelId) return;

      const key = `agent_progress:conversation:${conversationId}`;
      const raw = await redisService.getAllHashFields(key);
      const fields = Object.keys(raw);
      if (fields.length === 0) return;

      for (const agentUserId of fields) {
        let stored: Record<string, unknown> = {};
        try {
          stored = JSON.parse(raw[agentUserId]) as Record<string, unknown>;
        } catch {
          /* malformed field — still broadcast a best-effort done below */
        }
        // Write the session-scoped tombstone so any straggler `working` events from
        // this cancelled run are suppressed by the agentProgress endpoint and never
        // repopulate the hash (which would cause a ghost spinner on the next rehydrate).
        const storedSessionId = typeof stored.sessionId === 'string' ? stored.sessionId : null;
        if (storedSessionId) {
          await redisService.set(`agent_progress_done_session:${storedSessionId}`, new Date().toISOString(), 120);
        }
        const payload = { ...stored, conversationId, channelId, agentUserId, status: 'done', timestamp: new Date().toISOString() };
        await redisService.broadcastMessageToSession(channelId, {
          messageId: `agent_progress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          conversationId,
          senderId: agentUserId,
          senderName: String(stored.agentSlug ?? ''),
          content: JSON.stringify({ type: 'agent_progress', data: payload }),
          msgType: MessageType.SYSTEM,
          createdAt: new Date(),
        });
      }
      await redisService.deleteHashField(key, fields);
    } catch (error) {
      logger.error('[clearConversationAgentProgress] failed:', error);
      throw error;
    }
  };

  /**
   * Cancel an in-flight agent run for the given conversation.
   * Proxies to xyne-claw-auth's cancel endpoint using conversationId lookup.
   * POST /api/conversations/:conversationId/agent-cancel
   */
  cancelAgentRun = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const { agentSlug } = req.body as { agentSlug?: string };
      const userId = req.user?.id;

      if (!conversationId || !agentSlug || !userId) {
        res.status(400).json({ success: false, error: 'conversationId, agentSlug, and auth are required' });
        return;
      }

      const clawAuthUrl = `${config.xyneClaw.authUrl}/claw/api/v1/agent-chat/${encodeURIComponent(agentSlug)}/chat/cancel`;
      const cancelRes = await fetch(clawAuthUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
          ...(config.xyneClaw.s2sKey ? { 'x-s2s-key': config.xyneClaw.s2sKey } : {}),
        },
        body: JSON.stringify({ conversationId }),
      });

      if (!cancelRes.ok) {
        const body = (await cancelRes.json().catch(() => ({}))) as { error?: string };
        // Never forward a 401 from claw-auth to the client — apiClient.ts fires
        // clearAuthTokens + redirects to /auth on 401, which would log the user out.
        // 403 is safe to forward: the frontend interceptor only acts on 401, not 403.
        if (cancelRes.status === 401 || cancelRes.status === 403) {
          logger.warn('[cancelAgentRun] authorization failure from claw-auth', {
            originalStatus: cancelRes.status,
            conversationId,
            userId,
          });
        }
        const statusToSend = cancelRes.status === 401 ? 500 : cancelRes.status;
        res.status(statusToSend).json({ success: false, error: body.error ?? `Cancel failed: HTTP ${cancelRes.status}` });
        return;
      }

      // Clear the spinner only after cancel is confirmed — clears both channel and
      // thread views together. Doing this before would wipe the indicator even when
      // a non-owner's request is rejected upstream.
      try {
        await this.clearConversationAgentProgress(conversationId);
      } catch (cleanupError) {
        logger.error('[cancelAgentRun] progress cleanup failed after successful cancel:', cleanupError);
        res.status(500).json({ success: false, error: 'Cancel succeeded but progress state cleanup failed' });
        return;
      }

      const data = await cancelRes.json() as unknown;
      res.status(200).json(data);
    } catch (error) {
      logger.error('[cancelAgentRun] error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * Snapshot of in-flight agent-progress signals for this conversation.
   * Read-only view of the Redis hash written by xyne-claw-auth's agentProgress publisher.
   * Used by the dashboard when the thread panel opens so spinners re-hydrate after
   * leaving and re-entering the thread.
   * GET /api/conversations/:conversationId/agent-progress
   */
  getAgentProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      if (!conversationId) {
        res.status(400).json({ error: 'conversationId is required' });
        return;
      }
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Require the caller to have access to this conversation's channel before returning its
      // live agent-progress. Resolve conversation -> channel and require the same workspace +
      // membership as reading the conversation itself (PUBLIC channel = any workspace member,
      // PRIVATE = participant).
      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const progressChannel = await this.channelRepository.findById(conversation.channelId);
      if (!progressChannel || progressChannel.workspaceId !== req.user?.workspaceId) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      if (progressChannel.visibility === 'PRIVATE') {
        const isParticipant = await this.channelParticipantRepository.isParticipant(conversation.channelId, userId);
        if (!isParticipant) {
          res.status(403).json({ error: 'Access denied - not a channel participant' });
          return;
        }
      }

      const key = `agent_progress:conversation:${conversationId}`;
      const raw = await redisService.getAllHashFields(key);

      // Parse all entries first, separating malformed ones immediately.
      const parsed: Array<{ field: string; entry: Record<string, unknown> }> = [];
      const staleFields: string[] = [];
      for (const [field, v] of Object.entries(raw)) {
        try {
          parsed.push({ field, entry: JSON.parse(v) as Record<string, unknown> });
        } catch {
          staleFields.push(field);
        }
      }

      // Tombstone check — batch all Redis GETs in parallel (1 RTT regardless of N agents).
      // Tombstone is set BEFORE hash-delete and BEFORE the done WebSocket event is broadcast,
      // so any GET that fires after a done sees an authoritative empty/filtered result.
      // This prevents the rehydrate GET from resurrecting a spinner when the hook remounts
      // mid-transition (e.g. conversation object lazy-loads and sessionId changes).
      const tombstoneResults = await Promise.all(
        parsed.map(({ entry }) => {
          const sid = typeof entry.sessionId === 'string' ? entry.sessionId : null;
          return sid
            ? redisService.get(`agent_progress_done_session:${sid}`)
            : Promise.resolve(null);
        }),
      );

      const data: Record<string, unknown>[] = [];
      for (let i = 0; i < parsed.length; i++) {
        if (tombstoneResults[i]) {
          staleFields.push(parsed[i].field); // done — proactively clean up
        } else {
          data.push(parsed[i].entry);
        }
      }

      // Proactively delete stale fields so they don't accumulate in the hash.
      if (staleFields.length > 0) {
        await redisService.deleteHashField(key, staleFields).catch(() => { /* non-fatal */ });
      }
      res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error('[agentProgress/get] error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const userId = req.user!.id;
      if (!conversationId) {
        res.status(400).json({ error: 'Conversation ID is required' });
        return;
      }

      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const channel = await this.channelRepository.findById(conversation.channelId);
      if (channel?.visibility === 'PRIVATE') {
        const isParticipant = await this.channelParticipantRepository.isParticipant(
          conversation.channelId,
          userId
        );
        if (!isParticipant) {
          res.status(403).json({
            error: 'Access denied - not a channel participant',
            code: 'NOT_CHANNEL_PARTICIPANT',
          });
          return;
        }
      }

      if (!isThreadSummaryEnabledForChannel(conversation.channelId)) {
        res.status(204).end();
        return;
      }

      const result = await getOrGenerateThreadSummary(conversationId, { enforceMinMessages: false });
      if (!result) {
        res.status(204).end();
        return;
      }

      res.status(200).json({ success: true, ...result });
    } catch (error) {
      logger.error('[getSummary] error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getRecommendation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const userId = req.user!.id;
      if (!conversationId) {
        res.status(400).json({ error: 'Conversation ID is required' });
        return;
      }

      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation || !isThreadSummaryEnabledForChannel(conversation.channelId)) {
        res.status(200).json({ success: true, recommended: false, enabled: false });
        return;
      }

      const channel = await this.channelRepository.findById(conversation.channelId);
      if (channel?.visibility === 'PRIVATE') {
        const isParticipant = await this.channelParticipantRepository.isParticipant(
          conversation.channelId,
          userId
        );
        if (!isParticipant) {
          res.status(403).json({
            error: 'Access denied - not a channel participant',
            code: 'NOT_CHANNEL_PARTICIPANT',
          });
          return;
        }
      }

      if (!(await canRecommendThreadSummary(conversationId))) {
        res.status(200).json({ success: true, recommended: false, enabled: true });
        return;
      }

      const recommended = await consumeThreadRecommendation(conversationId, userId);
      if (!recommended) {
        res.status(200).json({ success: true, recommended: false, enabled: true });
        return;
      }

      const cached = await getCachedSummary(conversationId);
      const summary = cached && { content: cached.content, cached: true, asOfMessageId: cached.asOfMessageId };
      res.status(200).json({ success: true, recommended: true, enabled: true, summary });

      if (!(await hasPendingRecommendations(conversationId))) {
        await deleteCachedSummary(conversationId);
      }
    } catch (error) {
      logger.error('[getRecommendation] error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };



  private forwardTwinDraftAction = async (
    draft: TwinReplyDraft,
    action: 'approve' | 'decline',
    actorUserId: string,
    editedMessage?: string,
  ): Promise<{ ok: boolean; status: number; error?: string; posted?: { channelId: string; conversationId?: string } }> => {
    const base = config.xyneClaw.authUrl.replace(/\/+$/, '');
    const url = `${base}/claw/api/v1/internal/twin-draft/action`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.internalS2sKey ? { 'x-s2s-key': config.internalS2sKey } : {}),
        },
        body: JSON.stringify({
          action,
          actorUserId,
          ...(editedMessage !== undefined ? { editedMessage } : {}),
          draft,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await resp.text().catch(() => '');
      if (!resp.ok) {
        return { ok: false, status: resp.status, error: text.slice(0, 300) };
      }
      let posted: { channelId: string; conversationId?: string } | undefined;
      try {
        const parsed = JSON.parse(text) as { posted?: { channelId?: string; conversationId?: string } };
        if (parsed?.posted?.channelId) {
          posted = {
            channelId: parsed.posted.channelId,
            ...(parsed.posted.conversationId ? { conversationId: parsed.posted.conversationId } : {}),
          };
        }
      } catch {
      }
      return { ok: true, status: 200, ...(posted ? { posted } : {}) };
    } catch (err) {
      logger.error('[twin-draft-action] forward to claw-auth failed:', err);
      return { ok: false, status: 502, error: err instanceof Error ? err.message : String(err) };
    }
  };

  approveReplyDraft = async (req: Request, res: Response): Promise<void> => {
    try {
      const { draftId } = req.params;
      const userId = req.user!.id;
      if (!draftId) {
        res.status(400).json({ error: 'Draft ID is required' });
        return;
      }
      const draft = await getTwinReplyDraftById(draftId, userId);
      if (!draft) {
        res.status(404).json({ error: 'No draft to approve', code: 'NO_DRAFT' });
        return;
      }
      const editedRaw = (req.body as { editedMessage?: unknown } | undefined)?.editedMessage;
      const editedMessage = typeof editedRaw === 'string' ? editedRaw : undefined;

      const result = await this.forwardTwinDraftAction(draft, 'approve', userId, editedMessage);
      if (!result.ok) {
        res.status(502).json({ error: 'Failed to deliver reply', detail: result.error });
        return;
      }
      await deleteTwinReplyDraftById(draftId, userId);
      res.status(200).json({ success: true, ...(result.posted ? { posted: result.posted } : {}) });
    } catch (error) {
      logger.error('[approveReplyDraft] error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  declineReplyDraft = async (req: Request, res: Response): Promise<void> => {
    try {
      const { draftId } = req.params;
      const userId = req.user!.id;
      if (!draftId) {
        res.status(400).json({ error: 'Draft ID is required' });
        return;
      }
      const draft = await getTwinReplyDraftById(draftId, userId);
      if (!draft) {
        res.status(204).end(); // already gone — treat as success
        return;
      }
      await this.forwardTwinDraftAction(draft, 'decline', userId); // best-effort feedback
      await deleteTwinReplyDraftById(draftId, userId);
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[declineReplyDraft] error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
