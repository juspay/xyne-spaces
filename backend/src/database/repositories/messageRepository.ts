import { BaseRepository } from './base';
import { Message, MessageType } from '@prisma/client';
//import { logger } from '@/utils/logger';
import { PaginationOptions, PaginatedResult, QueryOptions } from '@/types/database';
import { websocketService } from '@/services/websocketService';
import {logger} from '@/utils/logger';
//import { queueMessageIngestion } from '@/queues/vespaQueue';

//import { extractAllMentions } from '@/utils/mentionParser';
export interface CreateMessageInput {
  conversationId: string;
  childConversationId?: string;
  senderId: string;
  content: string;
  msgType?: MessageType; // 'USER' | 'BOT'
  hasAttachment?: boolean;
  showInChannel?: boolean;
  visibleTo?: string | null; // null = public, userId = visible only to that user
  metadata?: Record<string, any>;
  createdAt?: Date; // Optional custom timestamp for migrations
}

export interface UpdateMessageInput {
  content?: string;
  childConversationId?: string;
  msgType?: MessageType;
  hasAttachment?: boolean;
  edited?: boolean;
  visibleTo?: string | null;
  metadata?: Record<string, any>;
}

export interface MessageFilters {
  conversationId?: string;
  senderId?: string;
  msgType?: string;
  hasAttachment?: boolean;
  before?: Date; // Messages before this timestamp
  after?: Date;  // Messages after this timestamp
  userId?: string; // For visibility filtering
}

export class MessageRepository extends BaseRepository<Message, CreateMessageInput, UpdateMessageInput> {
  constructor() {
    super('message');
  }

  async create(data: CreateMessageInput, disableMessageCountIncrement: boolean = false): Promise<Message> {
    
      await this.validateString(data.conversationId, 'conversationId');
    await this.validateString(data.senderId, 'senderId');
    
    // Content is required unless there are attachments OR it's a SYSTEM message with metadata
    const isSystemMessageWithMetadata = data.msgType === 'SYSTEM' && data.metadata;
    if (!data.hasAttachment && !isSystemMessageWithMetadata && (!data.content || data.content.trim() === '')) {
      throw new Error('content is required when no attachments are present');
    }
    
    // Validate content if provided
    if (data.content && data.content.trim() !== '') {
      await this.validateString(data.content, 'content', 10000); // Max 10k characters
    }

    if (data.msgType) {
      await this.validateEnum(data.msgType, 'msgType', ['USER', 'BOT', 'SYSTEM', 'FORWARDED']);
    }

     const result = await this.db.message.create({
        data: {
          conversationId: data.conversationId,
          senderId: data.senderId,
          content: data.content,
          msgType: data.msgType || 'USER',
          hasAttachment: data.hasAttachment || false,
          showInChannel: data.showInChannel ?? false,
          visibleTo: data.visibleTo ?? null,
          childConversationId: data.childConversationId,
          metadata: data.metadata,
          ...(data.createdAt && { createdAt: data.createdAt }),
        }
      });

   if (result.msgType === MessageType.USER && !disableMessageCountIncrement) {
    websocketService.incrementTodayMessageCount()
      .catch(err => logger.error('Failed to increment message count:', err));
    
    // Track the sender as an active user (optimized - no DB query)
    websocketService.trackUserActivity(result.senderId)
      .catch(err => logger.error('Failed to track user activity:', err));
  }

      // Log message creation
      // console.log(`[VESPA-FLOW] 1. Message created in DB: ${result.messageId}`);

      // // Queue message for Vespa ingestion with complete data (async, non-blocking)
      // // If this fails, message is still saved in DB
      // try {
      //   // Fetch sender, attachments, reactions, and conversation to include complete data
      //   const [sender, attachments, reactions, conversation] = await Promise.all([
      //     this.db.user.findUnique({ where: { id: result.senderId } }),
      //     this.db.messageAttachment.findMany({
      //       where: {
      //         entityId: result.messageId,
      //         entityType: 'CHAT'
      //       }
      //     }),
      //     this.db.reaction.findMany({
      //       where: {
      //         messageId: result.messageId
      //       }
      //     }),
      //     this.db.conversation.findUnique({ where: { conversationId: result.conversationId } })
      //   ]);

      //   // Extract mentions from content for Vespa
      //   const extractedMentions = extractAllMentions(result.content);


      //   // Combine data for Vespa with all required fields
      //   const messageWithRelations = {
      //     ...result,
      //     sender,
      //     attachments,
      //     // Add Vespa-specific fields
      //     channelId: conversation?.channelId || '',
      //     threadId: result.conversationId,
      //     mentions: extractedMentions.userIds || [],
      //     replyCount: 0, // Initial reply count - will be updated as replies are added
      //     reactions: reactions.length, // Send reaction count instead of array
      //     replyUsersCount: 0, // Initial reply users count
      //     updatedAt: new Date(result.createdAt), // Same as createdAt for new messages
      //     deletedAt: undefined,
      //     createdBy: sender?.email // Send user email instead of ID
      //   };

      //   await queueMessageIngestion(messageWithRelations, 'feed');
      // } catch (error) {
      //   logger.error(`[VESPA-FLOW] Failed to queue message for Vespa: ${result.messageId}`, error);
      //   // Don't throw - message is still saved in DB
      // }

      // console.log(`[VESPA-FLOW] 2. Message queued for Vespa ingestion: ${result.messageId}`);

      return result;
  }

  async findById(id: string): Promise<Message | null> {
    return await this.db.message.findUnique({
      where: { messageId: id }
    });
  }

  async findMany(options?: QueryOptions): Promise<Message[]>;
  async findMany(filters?: MessageFilters): Promise<Message[]>;
  async findMany(optionsOrFilters?: QueryOptions | MessageFilters): Promise<Message[]> {
    const filters = optionsOrFilters as MessageFilters;
    const where: any = {};

    if (filters?.conversationId) {
      where.conversationId = filters.conversationId;
    }

    if (filters?.senderId) {
      where.senderId = filters.senderId;
    }

    if (filters?.msgType) {
      where.msgType = filters.msgType;
    }

    if (filters?.hasAttachment !== undefined) {
      where.hasAttachment = filters.hasAttachment;
    }

    if (filters?.before || filters?.after) {
      where.createdAt = {};
      if (filters.before) {
        where.createdAt.lt = filters.before;
      }
      if (filters.after) {
        where.createdAt.gt = filters.after;
      }
    }

    // Visibility filter: show messages where visibleTo is null OR equals userId
    if (filters?.userId) {
      where.OR = [
        { visibleTo: null },
        { visibleTo: filters.userId }
      ];
    }

    return await this.db.message.findMany({
      where,
      orderBy: {
        createdAt: 'asc'
      }
    });
  }

  async update(id: string, data: UpdateMessageInput): Promise<Message> {
    if (data.content) {
      await this.validateString(data.content, 'content', 10000);
    }

    if (data.msgType) {
      await this.validateEnum(data.msgType, 'msgType', ['USER', 'BOT', 'SYSTEM', 'FORWARDED']);
    }

    const result = await this.db.message.update({
      where: { messageId: id },
      data
    });

    // Queue message update for Vespa with complete data
    // try {
    //   // Fetch all related data for complete Vespa document
    //   const [sender, attachments, reactions, conversation] = await Promise.all([
    //     this.db.user.findUnique({ where: { id: result.senderId } }),
    //     this.db.messageAttachment.findMany({
    //       where: {
    //         entityId: result.messageId,
    //         entityType: 'CHAT'
    //       }
    //     }),
    //     this.db.reaction.findMany({
    //       where: {
    //         messageId: result.messageId
    //       }
    //     }),
    //     this.db.conversation.findUnique({ where: { conversationId: result.conversationId } })
    //   ]);

    //   // Get replies only if this is the initial message of the conversation
    //   let replyCount = 0;
    //   let replyUsersCount = 0;
    //   if (conversation?.initialMessageId === result.messageId) {
    //     // Get count efficiently
    //     replyCount = await this.db.message.count({
    //       where: {
    //         conversationId: result.conversationId,
    //         createdAt: { gt: result.createdAt }
    //       }
    //     });

    //     // Only fetch senderId field for better performance
    //     const replies = await this.db.message.findMany({
    //       where: {
    //         conversationId: result.conversationId,
    //         createdAt: { gt: result.createdAt }
    //       },
    //       select: { senderId: true }
    //     });

    //     replyUsersCount = new Set(replies.map(r => r.senderId).filter(id => id !== result.senderId)).size;
    //   }

    //   // Extract mentions from updated content for Vespa
    //   const extractedMentions = extractAllMentions(result.content);

    //   // Combine data for Vespa with all required fields
    //   const messageWithRelations = {
    //     ...result,
    //     sender,
    //     attachments,
    //     // Add Vespa-specific fields with real data
    //     channelId: conversation?.channelId || '',
    //     threadId: result.conversationId,
    //     mentions: extractedMentions.userIds || [],
    //     replyCount,
    //     reactions: reactions.length, // Send reaction count instead of array
    //     replyUsersCount,
    //     updatedAt: new Date(), // Use current time for updates
    //     deletedAt: undefined,
    //     createdBy: sender?.email // Send user email instead of ID
    //   };

    //   await queueMessageIngestion(messageWithRelations, 'update');
    // } catch (error) {
    //   logger.error(`[VESPA-FLOW] Failed to queue message update for Vespa: ${result.messageId}`, error);
    //   // Don't throw - message is still updated in DB
    // }

    return result;
  }

  async delete(id: string): Promise<Message> {
    const result = await this.db.message.delete({
      where: { messageId: id }
    });

    // Queue message deletion from Vespa - only need ID
    // try {
    //   await queueMessageIngestion({ messageId: result.messageId }, 'delete');
    // } catch (error) {
    //   logger.error(`[VESPA-FLOW] Failed to queue message deletion for Vespa: ${result.messageId}`, error);
    //   // Don't throw - message is still deleted in DB
    // }

    return result;
  }

  // Chat-specific methods
  async getConversationMessages(
    conversationId: string,
    userId?: string,
    options?: PaginationOptions & { before?: Date }
  ): Promise<PaginatedResult<Message> | Message[]> {
    const where: any = { conversationId };

    if (options?.before) {
      where.createdAt = { lt: options.before };
    }

    // Visibility filter: show messages where visibleTo is null OR equals userId
    if (userId) {
      where.OR = [
        { visibleTo: null },
        { visibleTo: userId }
      ];
    }

    if (options && options.page && options.pageSize) {
      return await this.paginate(
        () => this.db.message.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...this.buildPaginationQuery(options)
        }),
        () => this.db.message.count({ where }),
        options
      );
    }

    return await this.db.message.findMany({
      where,
      orderBy: { createdAt: 'asc' }
    });
  }

  async getRecentMessages(conversationId: string, userId?: string, limit: number = 50): Promise<Message[]> {
    const where: any = { conversationId };

    // Visibility filter: show messages where visibleTo is null OR equals userId
    if (userId) {
      where.OR = [
        { visibleTo: null },
        { visibleTo: userId }
      ];
    }

    return await this.db.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  async getUserMessageCount(userId: string, conversationId?: string, requestingUserId?: string): Promise<number> {
    const where: any = { senderId: userId };

    if (conversationId) {
      where.conversationId = conversationId;
    }

    // Visibility filter: count only messages visible to requestingUserId
    if (requestingUserId) {
      where.OR = [
        { visibleTo: null },
        { visibleTo: requestingUserId }
      ];
    }

    return await this.db.message.count({ where });
  }

  async getConversationMessageCount(conversationId: string, userId?: string): Promise<number> {
    const where: any = { conversationId };

    // Visibility filter: count only messages visible to userId
    if (userId) {
      where.OR = [
        { visibleTo: null },
        { visibleTo: userId }
      ];
    }

    return await this.db.message.count({ where });
  }

  async deleteConversationMessages(conversationId: string): Promise<number> {
    const result = await this.db.message.deleteMany({
      where: { conversationId }
    });
    return result.count;
  }

  async searchMessages(conversationId: string, searchTerm: string, userId?: string, limit: number = 20): Promise<Message[]> {
    const where: any = {
      conversationId,
      content: {
        contains: searchTerm,
        mode: 'insensitive'
      }
    };

    // Visibility filter: show messages where visibleTo is null OR equals userId
    if (userId) {
      where.OR = [
        { visibleTo: null },
        { visibleTo: userId }
      ];
    }

    return await this.db.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  async getMessagesWithAttachments(conversationId: string): Promise<Message[]> {
    return await this.db.message.findMany({
      where: {
        conversationId,
        hasAttachment: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getChannelMessages(_channelId: string, limit: number = 100): Promise<Message[]> {
    // Get all conversations for this channel, then their messages
    // This requires joining through conversations
    return await this.db.message.findMany({
      where: {
        // We'll need to join with Conversation table
        // For now, this is a placeholder
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  async createWithExecutionId(data: CreateMessageInput, executionId: string): Promise<Message> {
    await this.validateString(data.conversationId, 'conversationId');
    await this.validateString(data.senderId, 'senderId');
    
    if (!data.hasAttachment && (!data.content || data.content.trim() === '')) {
      throw new Error('content is required when no attachments are present');
    }
    
    if (data.content && data.content.trim() !== '') {
      await this.validateString(data.content, 'content', 10000);
    }

    if (data.msgType) {
      await this.validateEnum(data.msgType, 'msgType', ['USER', 'BOT', 'SYSTEM', 'FORWARDED']);
    }

    const result = await this.db.message.create({
      data: {
        messageId: executionId,
        conversationId: data.conversationId,
        senderId: data.senderId,
        content: data.content || '',
        msgType: data.msgType || 'USER',
        hasAttachment: data.hasAttachment || false,
        showInChannel: data.showInChannel ?? false,
        visibleTo: data.visibleTo ?? null,
        metadata: data.metadata,
      }
    });

    // Refresh user counts for active users tracking (message via execution)
    if (result.msgType === MessageType.USER) {
      websocketService.incrementTodayMessageCount()
        .catch(err => logger.error('Failed to increment message count:', err));
      
      // Track user activity using Redis Set - O(1) operation, no DB query
      websocketService.trackUserActivity(result.senderId)
        .catch(err => logger.error('Failed to track user activity:', err));
    }

    return result;
  }

  /**
   * Get the conversationId for a given messageId
   * Used for reaction broadcasting to determine which conversation to broadcast to
   */
  async getConversationIdByMessageId(messageId: string): Promise<string | null> {
    const message = await this.db.message.findUnique({
      where: { messageId },
      select: { conversationId: true }
    });
    return message?.conversationId || null;
  }

  /**
   * Get the most recent message before a given timestamp in a conversation
   * Used for showInChannel reply count updates
   */
  async getMostRecentPreviousMessage(conversationId: string, beforeTimestamp: Date): Promise<Message | null> {
    const message = await this.db.message.findFirst({
      where: {
        conversationId,
        createdAt: {
          lt: beforeTimestamp,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return message;
  }

  /**
   * Find the head call message for a given callId.
   * Head messages have isCallMessage: true in their metadata.
   */
  async findHeadMessageByCallId(callId: string): Promise<Message | null> {
    return await this.db.message.findFirst({
      where: {
        AND: [
          {
            metadata: {
              path: ['callId'],
              equals: callId,
            },
          },
          {
            metadata: {
              path: ['isCallMessage'],
              equals: true,
            },
          },
        ],
      },
    });
  }
}
