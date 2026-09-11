import { BaseRepository } from './base';
import { ChannelParticipant } from '@prisma/client';
import { ChannelRole, UserStatus, UserType } from '@xyne/shared';
import { QueryOptions } from '@/types/database';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';

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

  private async getConversationSeenCutoffAt(
    tx: { conversation: { findMany: (args: any) => Promise<Array<{ createdAt: Date }>> } },
    channelId: string,
    fallbackDate: Date,
  ): Promise<Date> {
    const seenConversations = await tx.conversation.findMany({
      where: {
        channelId,
        createdAt: { lte: fallbackDate },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { createdAt: true },
    });

    return seenConversations[seenConversations.length - 1]?.createdAt ?? null;
  }

  async create(data: CreateChannelParticipantInput): Promise<ChannelParticipant> {
    await this.validateString(data.channelId, 'channelId');
    await this.validateString(data.userId, 'userId');

    if (data.role) {
      await this.validateEnum(data.role, 'role', ['ADMIN', 'MEMBER']);
    }

    return await this.db.$transaction(async (tx) => {
      const now = new Date();
      const conversationSeenCutoffAt = await this.getConversationSeenCutoffAt(
        tx,
        data.channelId,
        now,
      );

      const workspaceId = await resolveWorkspaceIdFromModel(tx, 'channel', { id: data.channelId });

      const participant = await tx.channelParticipant.create({
        data: {
          channelId: data.channelId,
          workspaceId,
          userId: data.userId,
          role: data.role || 'MEMBER',
        }
      });

      // Automatically create status record. Use upsert so a pre-existing status
      // row (e.g. orphaned from a prior partial migration run) is left as-is
      // instead of throwing a unique-constraint error on (channelId, userId).
      // desktopNotificationLevel / mobileNotificationLevel intentionally omitted —
      // null (inherit global) is the DB column default.
      await tx.channelUserStatus.upsert({
        where: { channelId_userId: { channelId: data.channelId, userId: data.userId } },
        update: {},
        create: {
          channelId: data.channelId,
          workspaceId,
          userId: data.userId,
          isClosed: false,
          isStarred: false,
          lastViewedAt: now,
          conversationSeenCutoffAt,
        }
      });

      // Increment participantCount in channel_stats
      await tx.channelStats.upsert({
        where: { channelId: data.channelId },
        update: { participantCount: { increment: 1 } },
        create: { channelId: data.channelId, workspaceId, participantCount: 1, lastActivityAt: new Date()},
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
  /**
   * Join a channel inside a caller-supplied transaction: participant row, status
   * row and the participantCount increment. Callers already holding a transaction
   * (e.g. one guarded by an advisory lock) must use this rather than
   * `addParticipant`, which opens its own and would not be covered by that lock.
   *
   * `conversationSeenCutoffAt` is a parameter because resolving it is a per-channel
   * `ORDER BY createdAt` scan that can take many seconds under load; running it here
   * would put it back inside the interactive transaction and reintroduce P2028.
   * Callers must resolve it via `resolveSeenCutoff` before opening their transaction.
   */
  async addParticipantInTransaction(
    tx: Parameters<Parameters<typeof this.db.$transaction>[0]>[0],
    channelId: string,
    userId: string,
    conversationSeenCutoffAt: Date | null,
    role: ChannelRole = ChannelRole.MEMBER,
    isClosed: boolean = false
  ): Promise<{ participant: ChannelParticipant; added: boolean }> {
    const now = new Date();
    const workspaceId = await resolveWorkspaceIdFromModel(tx, 'channel', { id: channelId });
    const inserted = await tx.channelParticipant.createMany({
      data: [{ channelId, workspaceId, userId, role: role || ChannelRole.MEMBER }],
      skipDuplicates: true,
    });
    const participant = await tx.channelParticipant.findUniqueOrThrow({
      where: { channelId_userId: { channelId, userId } },
    });
    if (inserted.count === 0) {
      return { participant, added: false };
    }

    // Automatically create status record. Use upsert so a pre-existing status
    // row (e.g. orphaned from a prior partial migration run) is left as-is
    // instead of throwing a unique-constraint error on (channelId, userId).
    // desktopNotificationLevel / mobileNotificationLevel intentionally omitted —
    // null (inherit global) is the DB column default.
    await tx.channelUserStatus.upsert({
      where: { channelId_userId: { channelId, userId } },
      update: {},
      create: {
        channelId,
        workspaceId,
        userId,
        isClosed,
        isStarred: false,
        lastViewedAt: now,
        conversationSeenCutoffAt,
      }
    });

    // Increment participantCount in channel_stats
    await tx.channelStats.upsert({
      where: { channelId },
      update: { participantCount: { increment: 1 } },
      create: { channelId, workspaceId, participantCount: 1, lastActivityAt: now },
    });

    return { participant, added: true };
  }

  /** Resolve the seen cutoff outside any transaction — see addParticipantInTransaction. */
  async resolveSeenCutoff(channelId: string, at: Date = new Date()): Promise<Date | null> {
    return this.getConversationSeenCutoffAt(this.db, channelId, at);
  }

  async addParticipant(channelId: string, userId: string, role: ChannelRole = ChannelRole.MEMBER, isClosed: boolean = false): Promise<ChannelParticipant> {
    // Existence check + the seen-cutoff scan run OUTSIDE the write transaction. getConversationSeenCutoffAt is a
    // per-channel `ORDER BY createdAt` scan that, under heavy parallel migration load, can take many seconds; leaving it
    // inside the interactive transaction ate the 5s budget and made the next query die with P2028. The common resume
    // re-add returns here without a transaction at all; the transaction below now holds only fast indexed writes.
    const existing = await this.db.channelParticipant.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (existing) {
      return existing;
    }

    const conversationSeenCutoffAt = await this.resolveSeenCutoff(channelId);

    const { participant } = await this.db.$transaction(async (tx) =>
      this.addParticipantInTransaction(tx, channelId, userId, conversationSeenCutoffAt, role, isClosed)
    );
    return participant;
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

      // Decrement participantCount in channel_stats
      await tx.channelStats.update({
        where: { channelId },
        data: { participantCount: { decrement: 1 } },
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

  /**
   * Return the channel's ACTIVE members as { id, name } — the minimal shape a participant picker
   * needs. Deactivated members are filtered out in the query, and no other user fields are read.
   */
  async getActiveChannelMembers(
    channelId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const participants = await this.db.channelParticipant.findMany({
      where: { channelId },
      select: { userId: true },
    });

    if (participants.length === 0) return [];

    const userIds = participants.map(p => p.userId);

    return this.db.user.findMany({
      where: { id: { in: userIds }, status: UserStatus.ACTIVE },
      select: { id: true, name: true },
    });
  }

  async getBotAppParticipantUserIds(channelId: string): Promise<string[]> {
    const participants = await this.db.channelParticipant.findMany({
      where: { channelId },
      select: { userId: true },
    });
    if (participants.length === 0) return [];

    const userIds = participants.map(p => p.userId);
    const botUsers = await this.db.user.findMany({
      where: { id: { in: userIds }, userType: { in: [UserType.BOT, UserType.APP] } },
      select: { id: true },
    });
    return botUsers.map(u => u.id);
  }

  async getUserChannels(userId: string): Promise<ChannelParticipant[]> {
    return await this.findMany({ userId });
  }

  async isParticipant(channelId: string, userId: string): Promise<boolean> {
    const participant = await this.findParticipant(channelId, userId);
    return participant !== null;
  }

  /**
   * Batch add participants to a channel in a single transaction.
   * Returns the number of participants actually added (excludes duplicates).
   *
   * @param overrideCutoffAt - When provided, skips the `getConversationSeenCutoffAt` query
   *   and uses this value directly as `conversationSeenCutoffAt` on every new
   *   `channel_user_status` row. Pass `new Date()` during migration so all
   *   already-ingested messages are pre-marked as seen (no unread badge).
   */
  async addParticipantsBatch(
    channelId: string,
    userIds: string[],
    role: ChannelRole = ChannelRole.MEMBER,
    isClosed: boolean = false,
    overrideCutoffAt?: Date,
  ): Promise<{ addedCount: number; existingCount: number }> {
    if (userIds.length === 0) {
      return { addedCount: 0, existingCount: 0 };
    }

    return await this.db.$transaction(async (tx) => {
      const now = new Date();
      const conversationSeenCutoffAt = overrideCutoffAt !== undefined
        ? overrideCutoffAt
        : await this.getConversationSeenCutoffAt(tx, channelId, now);
      const existingParticipants = await tx.channelParticipant.findMany({
        where: {
          channelId,
          userId: {
            in: userIds,
          },
        },
        select: {
          userId: true,
        },
      });

      const existingUserIds = new Set(existingParticipants.map((p) => p.userId));
      const newUserIds = userIds.filter((id) => !existingUserIds.has(id));

      if (newUserIds.length === 0) {
        return { addedCount: 0, existingCount: existingUserIds.size };
      }

      const workspaceId = await resolveWorkspaceIdFromModel(tx, 'channel', { id: channelId });

      await tx.channelParticipant.createMany({
        data: newUserIds.map((userId) => ({
          channelId,
          workspaceId,
          userId,
          role: role || 'MEMBER',
        })),
        skipDuplicates: true,
      });

      await tx.channelUserStatus.createMany({
        data: newUserIds.map((userId) => ({
          channelId,
          workspaceId,
          userId,
          isClosed,
          isStarred: false,
          lastViewedAt: now,
          conversationSeenCutoffAt,
        })),
        skipDuplicates: true,
      });

      await tx.channelStats.upsert({
        where: { channelId },
        update: { participantCount: { increment: newUserIds.length } },
        create: { channelId, workspaceId, participantCount: newUserIds.length, lastActivityAt: new Date() },
      });

      return { addedCount: newUserIds.length, existingCount: existingUserIds.size };
    });
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
