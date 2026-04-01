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
import { Message, MessageType, AttachmentEntityType } from '@prisma/client';
import { BotCommandParser, botProcessor, BotMessageMetadata } from '../services/bots';
import { getBotInfo, isRegisteredBot } from '../bots/core/bot-utils';
import { v4 as uuidv4 } from 'uuid';
import { SendMessageResponse, GetMessagesResponse } from '../api/types/MessageTypes';
import { config } from '../config/env';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { ChannelUserStatusRepository } from '@/database/repositories/channelUserStatusRepository';
import { unreadService } from '../services/unreadService';
import { MessagesSideEffectHandler } from '../zero/side-effects/tables/messages-handler';
import { vespaQueue } from '@/queues/vespaQueue';
import { messageSchema } from '@/vespa/src/types';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { replaceTicketSuggestionWithCreated } from '../utils/ticketSuggestionMarkdownGenerator';
import { markPulseItemAsSent as rewritePulseItemAsSent, updatePulseMerchant as rewritePulseMerchant } from '../utils/markPulseItemAsSent';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';

// Local type definitions
interface UserInfo {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

// Zod schema for validating file metadata structure
const fileMetadataSchema = z.array(z.object({
  fileIndex: z.number(),
  hasThumbnail: z.boolean(),
  thumbnailIndex: z.number().optional(),
  width: z.number().optional(), // Width in pixels (for images/videos)
  height: z.number().optional(), // Height in pixels (for images/videos)
  duration: z.number().optional(), // Duration in seconds (for videos)
}));

export class ConversationController {
  private conversationRepository: ConversationRepository;
  private channelRepository: ChannelRepository;
  private channelParticipantRepository: ChannelParticipantRepository;
  private messageRepository: MessageRepository;
  private messageAttachmentRepository: MessageAttachmentRepository;
  private reactionRepository: ReactionRepository;
  private userRepository: UserRepository;
  private channelUserStatusRespository: ChannelUserStatusRepository;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.channelRepository = new ChannelRepository();
    this.channelParticipantRepository = new ChannelParticipantRepository();
    this.messageRepository = new MessageRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();
    this.reactionRepository = new ReactionRepository();
    this.userRepository = new UserRepository();
    this.channelUserStatusRespository = new ChannelUserStatusRepository();
  }

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
      userId: string
    ): Promise<void> {
     
      vespaQueue.addJob({
        schema: messageSchema,
        jobType: "feed",
        docId: messageID,
        userId: userId,
      }).catch(async (error) => {
        logger.error('Error queuing Vespa job for channel:', error);
        try {
          const vespaLogs = db.vespaInsertionLogs;
          if (vespaLogs) {
            await vespaLogs.create({
              data: {
                status: "FAILED",
                type: "INSERT",
                entityId: messageID,
                entityType: messageSchema,
                namespace: NAMESPACE,
                errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
                errorDetails: JSON.stringify(error),
                userId: userId,
                createdAt: new Date(),
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
      const { content, msgType, visibleTo, fileMetadata: fileMetadataJson }: { content: string; msgType?: MessageType; visibleTo?: string | null; fileMetadata?: string } = req.body;
      const reqFiles = (req as Express.Request & { files?: { [fieldname: string]: Express.Multer.File[] } }).files || {};
      const files = reqFiles['files'] || [];
      const thumbnails = reqFiles['thumbnails'] || [];
      const userId = req.user!.id;

      // Parse file metadata if present
      let fileMetadata: Array<{ fileIndex: number; hasThumbnail: boolean; thumbnailIndex?: number }> | undefined;
      if (fileMetadataJson) {
        try {
          const parsedMetadata = JSON.parse(fileMetadataJson);
          fileMetadata = fileMetadataSchema.parse(parsedMetadata);
          logger.info('Received valid file metadata', { metadata: fileMetadata });
        } catch (error) {
          logger.error('Failed to parse or validate fileMetadata', { error });
          res.status(400).json({
            error: 'Invalid file metadata format',
            details: error instanceof z.ZodError ? error.errors : 'File metadata must be a valid JSON array'
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

      // Check if channel exists
      const channel = await this.channelRepository.findById(channelId);
      if (!channel) {
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
          await this.channelParticipantRepository.addParticipant(channelId, userId, 'MEMBER');
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

      // Create attachment records if files were uploaded
      if (uploadedFiles.length > 0) {
        logger.info(`fixingAttachment Creating ${uploadedFiles.length} attachment records for message ${message.messageId}`);
        const attachmentData: CreateMessageAttachmentInput[] = uploadedFiles.map(file => ({
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
      this.pushVespaJobForMessage(message.messageId, userId).catch(error => {
        logger.error(`[ConversationController] Error pushing Vespa job for message ${message.messageId}:`, error);
      });
      
      // Update conversation with real initial message ID
      await this.conversationRepository.update(conversation.conversationId, {
        initialMessageId: message.messageId,
      });

      // Update channel last activity
      await this.channelRepository.updateLastActivity(channelId);

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

      logger.info(`fixingAttachment complete: conversation ${conversation.conversationId} with ${attachments.length} attachments`);
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

      const handler = new MessagesSideEffectHandler({ userID: userId });
      handler.onInsert({
        entityId: message.messageId,
        entityType: 'messages',
        operation: 'insert'
      }).catch(err => logger.error('Side-effect handler error: createConversation', err));

      userActivityTrackingService.trackMessageSent(userId, {
        messageId: message.messageId,
      }).catch(error => {
        logger.error('[UserActivityTracking] Failed to track message sent activity:', {
          messageId: message.messageId,
          error: error instanceof Error ? error.message : String(error),
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

      // Check if channel exists
      const channel = await this.channelRepository.findById(channelId);
      if (!channel) {
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
            const initialMessage = await this.messageRepository.findById(conversation.initialMessageId);
            const senderInfo = initialMessage ? await this.getUserInfo(initialMessage.senderId) : null;

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
            attachments: attachments.map(att => ({
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
              metadata: att.metadata
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
      const { content, msgType, visibleTo, fileMetadata: fileMetadataJson }: { content: string; msgType?: MessageType; visibleTo?: string | null; fileMetadata?: string } = req.body;
      const reqFiles = (req as Express.Request & { files?: { [fieldname: string]: Express.Multer.File[] } }).files || {};
      const files = reqFiles['files'] || [];
      const thumbnails = reqFiles['thumbnails'] || [];
      const userId = req.user!.id;
      const showInChannel = req.body.showInChannel === true || req.body.showInChannel === 'true';

      // Parse file metadata if present
      let fileMetadata: Array<{ fileIndex: number; hasThumbnail: boolean; thumbnailIndex?: number }> | undefined;
      if (fileMetadataJson) {
        try {
          const parsedMetadata = JSON.parse(fileMetadataJson);
          fileMetadata = fileMetadataSchema.parse(parsedMetadata);
          logger.info('Received valid file metadata', { metadata: fileMetadata });
        } catch (error) {
          logger.error('Failed to parse or validate fileMetadata', { error });
          res.status(400).json({
            error: 'Invalid file metadata format',
            details: error instanceof z.ZodError ? error.errors : 'File metadata must be a valid JSON array'
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
            'MEMBER'
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
        const attachmentData: CreateMessageAttachmentInput[] = uploadedFiles.map(file => ({
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
      this.pushVespaJobForMessage(message.messageId, userId).catch(error => {
        logger.error(`[ConversationController] Error pushing Vespa job for message ${message.messageId}:`, error);
      });
      
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

        logger.info(`📤 [SEND-TO-CHANNEL] Created child conversation ${childConversationId} for message ${message.messageId}`);
      }

      // Update conversation reply count and last activity
      await this.conversationRepository.incrementReplyCount(conversationId);

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

      const handler = new MessagesSideEffectHandler({ userID: userId });
      handler.onInsert({
        entityId: message.messageId,
        entityType: 'messages',
        operation: 'insert'
      }).catch(err => logger.error('Side-effect handler error: replyToConversation', err));

      const response: SendMessageResponse = {
        messageId: message.messageId,
        conversationId: message.conversationId,
        content: message.content,
        msgType: message.msgType,
        hasAttachment: message.hasAttachment,
        edited: (message as Message & { edited?: boolean }).edited ?? false,
        attachments: attachments.map(att => ({
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
          metadata: att.metadata
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
            attachments: attachments.map(att => ({
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
              metadata: att.metadata
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

      if (parseResult.validatedInput.description && parseResult.validatedInput.description.length > 10000) {
        logger.info(`🔍 [BOT-CMD] Large description detected (${parseResult.validatedInput.description.length} chars), extracting...`);
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
      this.pushVespaJobForMessage(message.messageId, userId).catch(error => {
        logger.error(`[ConversationController] Error pushing Vespa job for message ${message.messageId}:`, error);
      });
      
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
          error: 'suggestionId, ticketId, xyneId, title, and ticketConversationId are required' 
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
      const updatedContent = rewritePulseItemAsSent(message.content, itemId, new Date().toISOString());

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
      const { merchantId: localMerchantId, orgId, orgName } = req.body as {
        merchantId: string;  // local frontmatter id, e.g. "m1"
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
      const matchedOrg = orgList.find(o => (o.id ?? o.orgId) === orgId);

      const pulseMerchantIds = matchedOrg?.merchantIdList ?? matchedOrg?.merchantIds ?? [];
      const pulseMerchantId = pulseMerchantIds.length > 0 ? pulseMerchantIds[0] : null;

      // Fetch product/lead data for this org
      const products = await pulseService.fetchOrgLeadData(orgId);
      const productId = products.length > 0 ? (products[0].id ?? (products[0] as any).productId ?? null) : null;

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
}
