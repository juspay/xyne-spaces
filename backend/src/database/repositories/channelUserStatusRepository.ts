import { ChannelUserStatus } from '@prisma/client';
import { BaseRepository } from './base';
import { QueryOptions } from '@/types/database';

export interface CreateChannelUserStatusInput {
  channelId: string;
  userId: string;
  lastViewedAt?: Date;
  lastViewedConversationId?: string;
  isStarred?: boolean;
  isClosed?: boolean;
}

export interface UpdateChannelUserStatusInput {
  lastViewedAt?: Date;
  lastViewedConversationId?: string;
  isStarred?: boolean;
  isClosed?: boolean;
}

export interface ChannelUserStatusFilters {
  channelId?: string;
  userId?: string;
  isStarred?: boolean;
  isClosed?: boolean;
  includeDeleted?: boolean;
}

export class ChannelUserStatusRepository extends BaseRepository<ChannelUserStatus, CreateChannelUserStatusInput, UpdateChannelUserStatusInput> {
  constructor() {
    super('channelUserStatus')
  }

  /**
   * Create a new channel user status record
   */
  async create(data: CreateChannelUserStatusInput): Promise<ChannelUserStatus> {
    const now = new Date();
    
    return this.db.channelUserStatus.create({
      data: {
        channelId: data.channelId,
        userId: data.userId,
        lastViewedAt: data.lastViewedAt ?? now,
        lastViewedConversationId: data.lastViewedConversationId,
        isStarred: data.isStarred ?? false,
        isClosed: data.isClosed ?? false,
      },
    });
  }

    async findById(id: string): Promise<ChannelUserStatus | null> {
      return await this.db.channelUserStatus.findUnique({
        where: { 
          id,
          isDeleted: false 
        }
      });
    }
  
    async findMany(options?: QueryOptions): Promise<ChannelUserStatus[]>;
    async findMany(filters?: ChannelUserStatusFilters): Promise<ChannelUserStatus[]>;
    async findMany(optionsOrFilters?: QueryOptions | ChannelUserStatusFilters): Promise<ChannelUserStatus[]> {
      const filters = optionsOrFilters as ChannelUserStatusFilters;
      const where: any = {};
  
      if (filters?.channelId) {
        where.channelId = filters.channelId;
      }
  
      if (filters?.userId) {
        where.userId = filters.userId;
      }
  
      if (filters?.isStarred) {
        where.isStarred = filters.isStarred;
      }

      if (filters?.isClosed) {
        where.isClosed = filters.isClosed;
      }

      if (!filters?.includeDeleted) {
        where.isDeleted = false;
      }
  
      return await this.db.channelUserStatus.findMany({
        where,
        orderBy: {
          lastViewedAt: 'desc'
        }
      });
    }

  /**
   * Find status by channel and user (excluding soft deleted)
   */
  async findByChannelAndUser(channelId: string, userId: string): Promise<ChannelUserStatus | null> {
    return this.db.channelUserStatus.findFirst({
      where: {
        channelId,
        userId,
        isDeleted: false,
      },
    });
  }

  /**
   * Update status record
   */
  async update(id: string, data: UpdateChannelUserStatusInput): Promise<ChannelUserStatus> {
    return this.db.channelUserStatus.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Update or create status record (upsert)
   */
  async upsert(
    channelId: string,
    userId: string,
    data: UpdateChannelUserStatusInput
  ): Promise<ChannelUserStatus> {
    const now = new Date();
    
    return this.db.channelUserStatus.upsert({
      where: {
        channelId_userId: {
          channelId,
          userId,
        },
      },
      update: {
        ...data,
        updatedAt: now,
      },
      create: {
        channelId,
        userId,
        lastViewedAt: data.lastViewedAt ?? now,
        lastViewedConversationId: data.lastViewedConversationId,
        isStarred: data.isStarred ?? false,
        isClosed: data.isClosed ?? false,
        updatedAt: now,
      },
    });
  }

  /**
   * Update last viewed timestamp and conversation
   */
  async updateLastViewed(
    channelId: string,
    userId: string,
    lastViewedAt?: Date,
    lastViewedConversationId?: string
  ): Promise<ChannelUserStatus> {
    const now = new Date();
    
    return this.upsert(channelId, userId, {
      lastViewedAt: lastViewedAt ?? now,
      lastViewedConversationId,
    });
  }

  async findParticipant(channelId: string, userId: string): Promise<ChannelUserStatus | null> {
    return await this.db.channelUserStatus.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId
        }
      }
    });
  }

  /**
   * Toggle starred status
   */
  async toggleStarred(channelId: string, userId: string): Promise<ChannelUserStatus> {
    const existing = await this.findByChannelAndUser(channelId, userId);
    if (!existing) {
      throw new Error('Channel user status not found');
    }

    return this.update(existing.id, {
      isStarred: !existing.isStarred,
    });
  }

  /**
   * Set closed status
   */
  async setClosedStatus(
    channelId: string,
    userId: string,
    isClosed: boolean
  ): Promise<ChannelUserStatus> {
    return this.upsert(channelId, userId, {
      isClosed,
    });
  }

  /**
   * Reopen all closed DM participants for a channel
   * Used when new messages are sent to DMs
   */
  async reopenForAllParticipants(channelId: string): Promise<void> {
    await this.db.channelUserStatus.updateMany({
      where: {
        channelId,
        isClosed: true,
      },
      data: {
        isClosed: false,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get all statuses for a user in specific channels
   */
  async findByUserAndChannels(
    userId: string,
    channelIds: string[]
  ): Promise<ChannelUserStatus[]> {
    return this.db.channelUserStatus.findMany({
      where: {
        userId,
        channelId: {
          in: channelIds,
        },
      },
    });
  }

  /**
   * Get all statuses for a channel
   */
  async findByChannel(channelId: string): Promise<ChannelUserStatus[]> {
    return this.db.channelUserStatus.findMany({
      where: {
        channelId,
      },
    });
  }

  /**
   * Delete status record
   */
  async delete(id: string): Promise<ChannelUserStatus> {
    return await this.db.channelUserStatus.delete({
      where: { id },
    });
  }

  /**
   * Delete status record by channel and user
   */
  async deleteByChannelAndUser(channelId: string, userId: string): Promise<void> {
    await this.db.channelUserStatus.delete({
      where: {
        channelId_userId: {
          channelId,
          userId,
        },
      },
    });
  }
}
