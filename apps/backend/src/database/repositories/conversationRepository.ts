import { BaseRepository } from './base';
import { Conversation } from '@prisma/client';
import { QueryOptions } from '@/types/database';

export interface CreateConversationInput {
  conversationId?: string; // Optional - for custom IDs (e.g., showInChannel child conversations)
  channelId: string;
  createdBy: string;
  initialMessageId: string;
  parentMessageId?: string;
  pinned?: boolean;
  doNotPostToChannel?: boolean;
  metadata?: Record<string, any>;
  createdAt?: Date; // Optional custom timestamp for migrations
}

export interface UpdateConversationInput {
  lastActivityAt?: Date;
  replyCount?: number;
  pinned?: boolean;
  parentMessageId?: string;
  metadata?: Record<string, any>;
  initialMessageId?: string;
  ticketId?: string;
}

export interface ConversationFilters {
  channelId?: string;
  createdBy?: string;
  pinned?: boolean;
}

export class ConversationRepository extends BaseRepository<Conversation, CreateConversationInput, UpdateConversationInput> {
  constructor() {
    super('conversation');
  }

  async create(data: CreateConversationInput): Promise<Conversation> {
    if (data.conversationId) {
      await this.validateString(data.conversationId, 'conversationId');
    }
    await this.validateString(data.channelId, 'channelId');
    await this.validateString(data.createdBy, 'createdBy');
    await this.validateString(data.initialMessageId, 'initialMessageId');

    // Stamp the denormalized tenant key from the owning channel.
    const channel = await this.db.channel.findUnique({
      where: { id: data.channelId },
      select: { workspaceId: true },
    });
    if (!channel) {
      throw new Error(`Channel not found: ${data.channelId}`);
    }

    return await this.db.conversation.create({
      data: {
        ...(data.conversationId && { conversationId: data.conversationId }),
        channelId: data.channelId,
        workspaceId: channel.workspaceId,
        createdBy: data.createdBy,
        initialMessageId: data.initialMessageId,
        parentMessageId: data.parentMessageId,
        pinned: data.pinned || false,
        ...(data.doNotPostToChannel !== undefined && {
          doNotPostToChannel: data.doNotPostToChannel,
        }),
        metadata: data.metadata,
        ...(data.createdAt && { createdAt: data.createdAt }),
      }
    });
  }

  async findById(id: string): Promise<Conversation | null> {
    return await this.db.conversation.findUnique({
      where: { conversationId: id }
    });
  }

  async findByIdAndWorkspace(conversationId: string, workspaceId: string): Promise<Conversation | null> {
    return await this.db.conversation.findFirst({
      where: {
        conversationId,
        channel: {
          workspaceId,
        },
      },
    });
  }

  async findMany(options?: QueryOptions): Promise<Conversation[]>;
  async findMany(filters?: ConversationFilters): Promise<Conversation[]>;
  async findMany(optionsOrFilters?: QueryOptions | ConversationFilters): Promise<Conversation[]> {
    const filters = optionsOrFilters as ConversationFilters;
    const where: any = {};

    if (filters?.channelId) {
      where.channelId = filters.channelId;
    }

    if (filters?.createdBy) {
      where.createdBy = filters.createdBy;
    }

    if (filters?.pinned !== undefined) {
      where.pinned = filters.pinned;
    }

    return await this.db.conversation.findMany({
      where,
      orderBy: [
        { pinned: 'desc' }, // Pinned conversations first
        { lastActivityAt: 'desc' } // Then by recent activity
      ]
    });
  }

  async update(id: string, data: UpdateConversationInput): Promise<Conversation> {
    return await this.db.conversation.update({
      where: { conversationId: id },
      data
    });
  }

  async updateMetadata(conversationId: string, metadata: Record<string, any>): Promise<Conversation> {
    return await this.db.conversation.update({
      where: { conversationId },
      data: { metadata },
    });
  }

  async delete(id: string): Promise<Conversation> {
    return await this.db.conversation.delete({
      where: { conversationId: id }
    });
  }

  // Conversation-specific methods
  async getChannelConversations(channelId: string): Promise<Conversation[]> {
    return await this.findMany({ channelId });
  }

  async getPinnedConversations(channelId: string): Promise<Conversation[]> {
    return await this.findMany({ channelId, pinned: true });
  }

  async incrementReplyCount(conversationId: string, skipParticipantUpdate = false): Promise<Conversation> {
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const now = new Date();
    const result = await this.update(conversationId, {
      replyCount: conversation.replyCount + 1,
      lastActivityAt: now,
    });

    // Update lastReplyAt on all participants (denormalized for userConversationsPaginatedV2).
    // Skipped during migration — the value would be the migration run time, not the
    // historical Slack timestamp, so it is incorrect anyway.
    if (!skipParticipantUpdate) {
      await this.db.conversationParticipant.updateMany({
        where: { conversationId },
        data: { lastReplyAt: now },
      });
    }

    return result;
  }

  async decrementReplyCount(conversationId: string): Promise<Conversation> {
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    const newReplyCount = Math.max(0, conversation.replyCount - 1);
    return await this.update(conversationId, {
      replyCount: newReplyCount,
    });
  }

  async updateLastActivity(conversationId: string): Promise<void> {
    await this.update(conversationId, {
      lastActivityAt: new Date(),
    });
  }

  async togglePin(conversationId: string): Promise<Conversation> {
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    return await this.update(conversationId, {
      pinned: !conversation.pinned,
    });
  }

  async getConversationWithInitialMessage(conversationId: string): Promise<any> {
    // This would typically join with messages table, but since we don't use FKs,
    // we'll need to manually fetch the initial message
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      return null;
    }

    // We'll need to import MessageRepository to get the initial message
    // For now, return just the conversation
    return conversation;
  }

  async searchConversationsByContent(channelId: string, _searchTerm: string): Promise<Conversation[]> {
    // This would require searching through message content
    // For now, we'll search by conversation metadata if it contains searchable fields
    return await this.db.conversation.findMany({
      where: {
        channelId,
        // Could add metadata search here if needed
      },
      orderBy: {
        lastActivityAt: 'desc'
      }
    });
  }

  /**
   * Get conversation to channel mapping for access control
   * Returns a Map of conversationId -> channelId
   */
  async getConversationChannelMapping(conversationIds: string[]): Promise<Map<string, string>> {
    const conversationChannelMap = new Map<string, string>();
    
    if (conversationIds.length === 0) return conversationChannelMap;
    
    // Use Prisma to get channel IDs for conversations
    const conversations = await this.db.conversation.findMany({
      where: {
        conversationId: {
          in: conversationIds
        }
      },
      select: {
        conversationId: true,
        channelId: true
      }
    });

    // Build the conversation -> channel mapping
    for (const conversation of conversations) {
      conversationChannelMap.set(conversation.conversationId, conversation.channelId);
    }

    return conversationChannelMap;
  }

  async migrateConversationsToChannel(
    conversationIds: string[],
    targetChannelId: string
  ): Promise<number> {
    if (conversationIds.length === 0) {
      return 0;
    }

    const result = await this.db.conversation.updateMany({
      where: {
        conversationId: {
          in: conversationIds
        }
      },
      data: {
        channelId: targetChannelId
      }
    });

    return result.count;
  }

  /**
   * Get ticket ID by conversation ID
   */
  async getTicketIdByConversationId(conversationId: string): Promise<string | null> {
    const conversation = await this.db.conversation.findUnique({
      where: { conversationId },
      select: { ticketId: true }
    });
    return conversation?.ticketId || null;
  }

  async findManyWithCursor(
    channelId: string,
    limit: number,
    cursor?: { conversationId: string; createdAt: number }
  ): Promise<Array<{ conversationId: string; initialMessageId: string; createdAt: Date }>> {
    const where: any = { channelId };

    if (cursor) {
      where.OR = [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        {
          createdAt: new Date(cursor.createdAt),
          conversationId: { lt: cursor.conversationId }
        }
      ];
    }

    return await this.db.conversation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        conversationId: true,
        initialMessageId: true,
        createdAt: true,
      },
    });
  }
}
