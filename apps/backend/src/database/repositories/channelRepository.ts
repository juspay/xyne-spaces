import { SDLC_MEMBERSHIP_RELATION } from '@xyne/shared';
import { BaseRepository } from './base';
import { Channel, Prisma } from '@prisma/client';
import { ChannelScopeType, ChannelVisibility, ChannelType, ProjectType } from '@xyne/shared';
import { QueryOptions } from '@/types/database';
import { logger } from '@/utils/logger';
import { withWorkspaceScope } from '@/database/tenant/context';
//import { queueChannelIngestion } from '@/queues/vespaQueue';

export interface CreateChannelInput {
  scopeType: ChannelScopeType;
  name: string;
  description?: string;
  visibility?: ChannelVisibility;
  createdBy: string;
  projectId: string;
  workspaceId: string;
  type?: ChannelType;
}

export interface UpdateChannelInput {
  name?: string;
  description?: string;
  isMigrated?: boolean;
  type?: ChannelType;
}

export interface ChannelFilters {
  scopeType?: ChannelScopeType;
  visibility?: ChannelVisibility;
}

export class ChannelRepository extends BaseRepository<Channel, CreateChannelInput, UpdateChannelInput> {
  constructor() {
    super('channel');
  }

  async create(data: CreateChannelInput): Promise<Channel> {
    // Skip 255 char validation for DM and GROUP_DM channels
    // Their names are comma-separated user IDs (internal identifiers)
    // and can exceed 255 chars with many participants
    const isDMChannel = data.scopeType === ChannelScopeType.DM || data.scopeType === ChannelScopeType.GROUP_DM;
    if (!isDMChannel) {
      await this.validateString(data.name, 'name', 255);
    }
    await this.validateString(data.createdBy, 'createdBy');
    await this.validateString(data.scopeType, 'scopeType');
    await this.validateString(data.projectId, 'projectId');
    await this.validateEnum(data.scopeType, 'scopeType', ['DEFAULT', 'DM', 'TICKET', 'DOCUMENT', 'GROUP_DM']);

    // Validate visibility if provided
    if (data.visibility) {
      await this.validateEnum(data.visibility, 'visibility', ['PUBLIC', 'PRIVATE']);
    }

    // Check for duplicate channel name within the workspace
    const isDuplicate = await this.checkDuplicateName(data.name, data.workspaceId);
    if (isDuplicate) {
      throw new Error(`Channel with name "${data.name}" already exists.`);
    }

    const result = await this.db.channel.create({
      data: {
        scopeType: data.scopeType,
        name: data.name,
        description: data.description,
        visibility: data.visibility || 'PUBLIC',
        createdBy: data.createdBy,
        projectId: data.projectId,
        workspaceId: data.workspaceId,
        ...(data.type && { type: data.type }),
      }
    });

    // Dual-write: mirror the channel→project board set into ChannelBoardMapping
    // so downstream consumers never need to read channel.projectId.
    const boards = await this.db.board.findMany({
      where: { projectId: data.projectId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (boards.length > 0) {
      const now = new Date();
      await this.db.channelBoardMapping.createMany({
        data: boards.map((board, index) => ({
          channelId: result.id,
          boardId: board.id,
          workspaceId: data.workspaceId,
          isDefault: index === 0,
          createdBy: data.createdBy,
          createdAt: now,
          updatedAt: now,
        })),
        skipDuplicates: true,
      });
    }

    return result;
  }

  /**
   * Concurrency-safe get-or-create for DM / GROUP_DM / self-DM channels.
   *
   * The normalized participant set is materialized in `channel.name` (sorted,
   * comma-joined user IDs), and a partial unique index on
   * (workspaceId, name) WHERE scopeType IN ('DM','GROUP_DM') is the real
   * source of truth. We insert optimistically and, if a concurrent request
   * won the race (Prisma P2002), we re-fetch and return the existing channel.
   *
   * Unlike `create()`, this path deliberately skips the app-level
   * `checkDuplicateName` SELECT — that check is itself part of the check-then-
   * create race; the DB constraint is what actually guarantees uniqueness.
   *
   * @returns the channel plus `created` = false when an existing channel was
   *          returned because of a concurrent insert.
   */
  async getOrCreateDmChannel(
    data: CreateChannelInput,
  ): Promise<{ channel: Channel; created: boolean }> {
    if (data.scopeType !== ChannelScopeType.DM && data.scopeType !== ChannelScopeType.GROUP_DM) {
      throw new Error(`getOrCreateDmChannel only supports DM/GROUP_DM, got ${data.scopeType}`);
    }

    try {
      const channel = await this.db.channel.create({
        data: {
          scopeType: data.scopeType,
          name: data.name,
          description: data.description,
          visibility: data.visibility || 'PRIVATE',
          createdBy: data.createdBy,
          projectId: data.projectId,
          workspaceId: data.workspaceId,
          ...(data.type && { type: data.type }),
        },
      });
      return { channel, created: true };
    } catch (error) {
      // A concurrent "open DM" request inserted the same (workspaceId, name)
      // between our lookup and this insert — the partial unique index rejects
      // it (P2002). Return the winner's channel instead of a duplicate.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.db.channel.findFirst({
          where: {
            workspaceId: data.workspaceId,
            name: data.name,
            scopeType: data.scopeType,
          },
        });
        if (existing) {
          logger.info(
            `[getOrCreateDmChannel] Lost create race for ${data.scopeType} "${data.name}" in workspace ${data.workspaceId}; returning existing channel ${existing.id}`,
          );
          return { channel: existing, created: false };
        }
      }
      throw error;
    }
  }

  /**
   * Queue channel for Vespa ingestion with complete data
   * Should be called AFTER participants are added to the channel
   */

  async findById(id: string): Promise<Channel | null> {
    return await this.db.channel.findUnique({
      where: { id }
    });
  }

  /**
   * Scope of a channel, read under workspace scope so a legitimate non-member caller can
   * still classify it — same rationale as `getDMChannel`'s existence probe. Callers that
   * need to tell a direct call from a channel-scoped one can't use `findById`: a large
   * group call sits in the organizer's self-DM, which no other participant belongs to,
   * so the per-user channel ACL hides the row and the call looks channel-less.
   */
  async getScopeType(channelId: string): Promise<Channel['scopeType'] | null> {
    return withWorkspaceScope(async () => {
      const channel = await this.db.channel.findUnique({
        where: { id: channelId },
        select: { scopeType: true },
      });
      return channel?.scopeType ?? null;
    });
  }

  async getWorkspaceId(channelId: string): Promise<string> {
    const channel = await this.db.channel.findUnique({
      where: { id: channelId },
      select: { workspaceId: true },
    });
    if (!channel?.workspaceId) {
      throw new Error(`Could not find workspaceId for channel ${channelId}`);
    }
    return channel.workspaceId;
  }

  async findMany(options?: QueryOptions): Promise<Channel[]>;
  async findMany(filters?: ChannelFilters): Promise<Channel[]>;
  async findMany(optionsOrFilters?: QueryOptions | ChannelFilters): Promise<Channel[]> {
    const filters = optionsOrFilters as ChannelFilters;
    const where: any = {};

    logger.info("scopeType", filters.scopeType)

    if (filters?.scopeType) {
      where.scopeType = filters.scopeType;
    }


    if (filters?.visibility) {
      where.visibility = filters.visibility;
    }

    return await this.db.channel.findMany({
      where,
      orderBy: {
        channelStats: {
          lastActivityAt: 'desc'
        }
      }
    });
  }

  async findManyPaginated(options: {
    where?: Record<string, unknown>;
    limit: number;
    cursor?: string;
  }): Promise<Channel[]> {
    const { where = {}, limit, cursor } = options;

    return await this.db.channel.findMany({
      where,
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: UpdateChannelInput): Promise<Channel> {
    if (data.name) {
      // Skip 255 char validation for DM and GROUP_DM channels
      // Their names are comma-separated user IDs (internal identifiers)
      // and can exceed 255 chars with many participants
      const channel = await this.findById(id);
      const isDMChannel = channel?.scopeType === ChannelScopeType.DM || channel?.scopeType === ChannelScopeType.GROUP_DM;

      if (!isDMChannel) {
        await this.validateString(data.name, 'name', 255);
      }
    }

    const result = await this.db.channel.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      }
    });

    // Queue channel update for Vespa
    // await this.queueChannelForVespa(result.id, 'update');

    return result;
  }

  async delete(id: string): Promise<Channel> {
    const attachedSdlcRepository = await this.db.sdlcEntityLink.findFirst({
      where: { channelId: id, relationType: SDLC_MEMBERSHIP_RELATION },
      select: { id: true },
    });
    if (attachedSdlcRepository) {
      throw new Error('Detach SDLC repositories before deleting their hidden channel');
    }
    const result = await this.db.channel.delete({
      where: { id }
    });

    // Queue channel deletion from Vespa
    // await this.queueChannelForVespa(result.id, 'delete');

    return result;
  }

  // Channel-specific methods
  async updateLastActivity(id: string): Promise<void> {
    const workspaceId = await this.getWorkspaceId(id);
    await this.db.channelStats.upsert({
      where: { channelId: id },
      update: { lastActivityAt: new Date() },
      create: { channelId: id, workspaceId, lastActivityAt: new Date() },
    });
  }

  // Set lastActivityAt to MAX(message.createdAt); used post-migration to replace the `now` placeholder.
  async recalculateLastActivityFromMessages(channelId: string): Promise<void> {
    const latest = await this.db.message.findFirst({
      where: { conversation: { channelId } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!latest) return;

    const workspaceId = await this.getWorkspaceId(channelId);
    await this.db.channelStats.upsert({
      where: { channelId },
      update: { lastActivityAt: latest.createdAt },
      create: { channelId, workspaceId, lastActivityAt: latest.createdAt },
    });
  }

  // Set lastActivityAt explicitly so a migrated DM lands at its real position, not the `now` placeholder.
  async setLastActivity(channelId: string, at: Date): Promise<void> {
    const workspaceId = await this.getWorkspaceId(channelId);
    await this.db.channelStats.upsert({
      where: { channelId },
      update: { lastActivityAt: at },
      create: { channelId, workspaceId, lastActivityAt: at },
    });
  }

  async incrementUnreadForAllMembers(channelId: string, increment: number): Promise<void> {
    if (increment <= 0) return;
    await this.db.channelUserStatus.updateMany({
      where: { channelId, isDeleted: false },
      data: { unreadCount: { increment }, updatedAt: new Date() },
    });
  }

  async getChannelsByScope(scopeType: ChannelScopeType): Promise<Channel[]> {
    return await this.findMany({ scopeType });
  }

  async getDMChannel(userId1: string, userId2: string): Promise<Channel | null> {
    // Run the existence probe under withWorkspaceScope (service actor) so the per-user
    // channel ACL is dropped and only workspace scope applies — otherwise a non-participant
    // caller (e.g. an automation submitter probing an admin's bot DM) never sees the existing
    // PRIVATE DM and mints a duplicate. orderBy asc pins the oldest as the canonical match.
    return withWorkspaceScope(async () => {
      // Self-DM: channel name is stored as single userId, scopeType DM
      if (userId1 === userId2) {
        return await this.db.channel.findFirst({
          where: { name: userId1, scopeType: ChannelScopeType.DM },
          orderBy: { createdAt: 'asc' },
        });
      }
      // For 1:1 DM channels, name is sorted user IDs joined by comma
      const name = [userId1, userId2].sort().join(",");
      return await this.db.channel.findFirst({
        where: { name },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  async getChannelsByIds(channelIds: string[], filters?: Omit<ChannelFilters, 'channelId'>): Promise<Channel[]> {
    if (channelIds.length === 0) {
      return [];
    }

    const where: any = {
      id: {
        in: channelIds
      }
    };

    // Apply additional filters if provided
    if (filters?.scopeType) {
      where.scopeType = filters.scopeType;
    }

    if (filters?.visibility) {
      where.visibility = filters.visibility;
    }

    return await this.db.channel.findMany({
      where,
      orderBy: {
        channelStats: {
          lastActivityAt: 'desc'
        }
      }
    });
  }

  async getGroupChannelByMembers(memberIds: string[]): Promise<Channel | null> {
    // Same rationale as getDMChannel: the existence probe must not be filtered by the
    // caller's participation, and must resolve to a single canonical (oldest) row.
    const name = memberIds.sort().join(",");
    return withWorkspaceScope(async () =>
      this.db.channel.findFirst({
        where: {
          scopeType: ChannelScopeType.GROUP_DM,
          name: name,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async checkDuplicateName(name: string, workspaceId: string): Promise<boolean> {
    const existingChannel = await this.db.channel.findFirst({
      where: { name, project: { workspaceId } }
    });
    return !!existingChannel;
  }

  async findByName(name: string): Promise<Channel | null> {
    return await this.db.channel.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive'
        }
      }
    });
  }

  /**
   * Find or create a DM or GROUP_DM channel based on the number of invited users.
   * If the resulting channel name would exceed 255 characters (>~10 members),
   * falls back to the initiator's self-DM to avoid the DB constraint.
   * @param userId - The ID of the user initiating the channel creation
   * @param invitedUserIds - Array of user IDs to include in the channel
   * @param channelParticipants - Channel participants repository for adding users
   * @param workspaceId - The workspace ID to get the DM project from
   * @returns The channel ID (either existing or newly created)
   */
  async findOrCreateDMChannel(
    userId: string,
    invitedUserIds: string[],
    channelParticipants: any, // We'll pass this from the controller to avoid circular dependency
    workspaceId: string
  ): Promise<string> {
    if (invitedUserIds.length === 0) {
      throw new Error('No users to invite');
    }

    // Get DM project for this workspace
    const dmProject = await this.db.project.findFirst({
      where: {
        workspaceId,
        code: 'DM',
        type: ProjectType.DM,
      },
    });

    if (!dmProject) {
      throw new Error('DM project not found for workspace');
    }

    const projectId = dmProject.id;

    // Single user - create or find DM channel
    if (invitedUserIds.length === 1) {
      const targetUserId = invitedUserIds[0];

      // Check if DM channel exists
      let dmChannel = await this.getDMChannel(userId, targetUserId);

      if (dmChannel) {
        return dmChannel.id;
      }

      // Create new DM channel
      const dmChannelName = [userId, targetUserId].sort().join(',');

      // Concurrency-safe: partial unique index guards against duplicate DMs.
      dmChannel = (await this.getOrCreateDmChannel({
        scopeType: ChannelScopeType.DM,
        name: dmChannelName,
        visibility: ChannelVisibility.PRIVATE,
        createdBy: userId,
        projectId,
        workspaceId,
      })).channel;

      // Add both users as participants
      await channelParticipants.addParticipant(dmChannel.id, userId, 'ADMIN', false);
      await channelParticipants.addParticipant(dmChannel.id, targetUserId, 'MEMBER', false);

      return dmChannel.id;
    }

    // Multiple users - create or find group DM channel
    const allUserIds = [userId, ...invitedUserIds].sort();
    const groupDmName = allUserIds.join(',');

    // If the name would exceed 255 chars (large groups, ~9+ members),
    // fall back to the initiator's self-DM
    const isLargeGroup = groupDmName.length > 255;

    if (!isLargeGroup) {
      // Check if group DM already exists with these exact participants
      const existingGroupDM = await this.getGroupChannelByMembers(allUserIds);

      if (existingGroupDM) {
        return existingGroupDM.id;
      }

      // Create new group DM channel
      // Concurrency-safe: partial unique index guards against duplicate group DMs.
      const groupDMChannel = (await this.getOrCreateDmChannel({
        scopeType: ChannelScopeType.GROUP_DM,
        name: groupDmName,
        visibility: ChannelVisibility.PRIVATE,
        createdBy: userId,
        projectId,
        workspaceId,
      })).channel;

      // Add all users as participants
      await channelParticipants.addParticipant(groupDMChannel.id, userId, 'ADMIN', false);
      for (const invitedId of invitedUserIds) {
        await channelParticipants.addParticipant(groupDMChannel.id, invitedId, 'MEMBER', false);
      }

      return groupDMChannel.id;
    }

    // Large group: create nothing — back the group with the initiator's own self-DM
    // (the "Saved messages" DM, keyed on the bare userId). Calls get their access
    // from call_participants, so invitees still see and join without a channel.
    const selfDm = await this.getDMChannel(userId, userId);
    if (selfDm) {
      return selfDm.id;
    }

    // Self-DM is provisioned at login; create it here only if it is somehow missing.
    const newSelfDm = await this.create({
      scopeType: ChannelScopeType.DM,
      name: userId,
      description: 'Saved messages',
      visibility: ChannelVisibility.PRIVATE,
      createdBy: userId,
      projectId,
      workspaceId,
    });
    await channelParticipants.addParticipant(newSelfDm.id, userId, 'ADMIN', false);

    return newSelfDm.id;
  }

}
