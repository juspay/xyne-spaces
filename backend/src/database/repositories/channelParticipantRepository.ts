import { BaseRepository } from './base';
import { ChannelParticipant, ChannelRole } from '@prisma/client';
import { QueryOptions } from '@/types/database';

export interface CreateChannelParticipantInput {
  channelId: string;
  userId: string;
  role?: ChannelRole;
}

export interface UpdateChannelParticipantInput {
  role?: ChannelRole;
}

export interface ChannelParticipantFilters {
  channelId?: string;
  userId?: string;
  role?: ChannelRole;
}

export class ChannelParticipantRepository extends BaseRepository<ChannelParticipant, CreateChannelParticipantInput, UpdateChannelParticipantInput> {
  constructor() {
    super('channelParticipant');
  }

  async create(data: CreateChannelParticipantInput): Promise<ChannelParticipant> {
    await this.validateString(data.channelId, 'channelId');
    await this.validateString(data.userId, 'userId');

    if (data.role) {
      await this.validateEnum(data.role, 'role', ['ADMIN', 'MEMBER']);
    }

    return await this.db.$transaction(async (tx) => {
      const participant = await tx.channelParticipant.create({
        data: {
          channelId: data.channelId,
          userId: data.userId,
          role: data.role || 'MEMBER',
        }
      });

      // Automatically create status record
      await tx.channelUserStatus.create({
        data: {
          channelId: data.channelId,
          userId: data.userId,
          isClosed: false,
          isStarred: false,
          lastViewedAt: new Date(),
        }
      });

      // Increment participantCount
      await tx.channel.update({
        where: { id: data.channelId },
        data: {
          participantCount: {
            increment: 1
          }
        }
      });

      return participant;
    });
  }

  async findById(id: string): Promise<ChannelParticipant | null> {
    return await this.db.channelParticipant.findUnique({
      where: { id }
    });
  }

  async findMany(options?: QueryOptions): Promise<ChannelParticipant[]>;
  async findMany(filters?: ChannelParticipantFilters): Promise<ChannelParticipant[]>;
  async findMany(optionsOrFilters?: QueryOptions | ChannelParticipantFilters): Promise<ChannelParticipant[]> {
    const filters = optionsOrFilters as ChannelParticipantFilters;
    const where: any = {};

    if (filters?.channelId) {
      where.channelId = filters.channelId;
    }

    if (filters?.userId) {
      where.userId = filters.userId;
    }

    if (filters?.role) {
      where.role = filters.role;
    }

    return await this.db.channelParticipant.findMany({
      where,
      orderBy: {
        joinedAt: 'desc'
      }
    });
  }

  async update(id: string, data: UpdateChannelParticipantInput): Promise<ChannelParticipant> {
    if (data.role) {
      await this.validateEnum(data.role, 'role', ['ADMIN', 'MEMBER']);
    }

    return await this.db.channelParticipant.update({
      where: { id },
      data
    });
  }

  async delete(id: string): Promise<ChannelParticipant> {
    return await this.db.channelParticipant.delete({
      where: { id }
    });
  }

  // Channel Participant specific methods
  async addParticipant(channelId: string, userId: string, role: ChannelRole = 'MEMBER', isClosed: boolean = false): Promise<ChannelParticipant> {
    return await this.db.$transaction(async (tx) => {
      // Check if participant already exists
      const existing = await tx.channelParticipant.findUnique({
        where: {
          channelId_userId: {
            channelId,
            userId
          }
        }
      });
      if (existing) {
        return existing;
      }

      // Create participant
      const participant = await tx.channelParticipant.create({
        data: {
          channelId,
          userId,
          role: role || 'MEMBER',
        }
      });

      // Automatically create status record
      await tx.channelUserStatus.create({
        data: {
          channelId,
          userId,
          isClosed,
          isStarred: false,
          lastViewedAt: new Date(),
        }
      });

      // Increment participantCount
      await tx.channel.update({
        where: { id: channelId },
        data: {
          participantCount: {
            increment: 1
          }
        }
      });

      return participant;
    });
  }

  async removeParticipant(channelId: string, userId: string): Promise<void> {
    const participant = await this.findParticipant(channelId, userId);
    if (!participant) {
      return;
    }

    await this.db.$transaction(async (tx) => {
      // Delete participant
      await tx.channelParticipant.delete({
        where: { id: participant.id }
      });

      // Also delete the status record
      await tx.channelUserStatus.deleteMany({
        where: { channelId, userId }
      });

      // Decrement participantCount
      await tx.channel.update({
        where: { id: channelId },
        data: {
          participantCount: {
            decrement: 1
          }
        }
      });
    });
  }

  async findParticipant(channelId: string, userId: string): Promise<ChannelParticipant | null> {
    return await this.db.channelParticipant.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId
        }
      }
    });
  }

  async getChannelParticipants(channelId: string): Promise<ChannelParticipant[]> {
    return await this.findMany({ channelId });
  }

  /**
   * Get all participants for a channel with their user details.
   * ChannelParticipant has no Prisma FK relation to User, so we do a two-step
   * batch fetch: participants → user IDs → users (same pattern as callRepository).
   * Used for building mention maps in documents / AI prompts.
   */
  async getChannelParticipantsWithUserDetails(
    channelId: string
  ): Promise<Array<{ userId: string; userName: string; userEmail: string; userPicture: string | null }>> {
    // Step 1: get participant user IDs
    const participants = await this.db.channelParticipant.findMany({
      where: { channelId },
      select: { userId: true },
    });

    if (participants.length === 0) return [];

    const userIds = participants.map(p => p.userId);

    // Step 2: batch-fetch user details
    const users = await this.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, picture: true },
    });

    return users.map(u => ({
      userId: u.id,
      userName: u.name,
      userEmail: u.email,
      userPicture: u.picture,
    }));
  }

  async getUserChannels(userId: string): Promise<ChannelParticipant[]> {
    return await this.findMany({ userId });
  }

  async isParticipant(channelId: string, userId: string): Promise<boolean> {
    const participant = await this.findParticipant(channelId, userId);
    return participant !== null;
  }

  async getParticipantRole(channelId: string, userId: string): Promise<string | null> {
    const participant = await this.findParticipant(channelId, userId);
    return participant?.role || null;
  }

  async updateParticipantRole(channelId: string, userId: string, role: ChannelRole): Promise<ChannelParticipant | null> {
    const participant = await this.findParticipant(channelId, userId);
    if (!participant) {
      return null;
    }

    return await this.update(participant.id, { role });
  }


  /**
   * Batch check which channels a user is a participant of
   * Returns a Set of channel IDs the user has access to
   */
  async getAccessibleChannelIds(channelIds: string[], userId: string): Promise<Set<string>> {
    if (channelIds.length === 0) {
      return new Set<string>();
    }

    const participants = await this.db.channelParticipant.findMany({
      where: {
        channelId: {
          in: channelIds
        },
        userId
      },
      select: {
        channelId: true
      }
    });

    return new Set(participants.map(p => p.channelId));
  }
}
