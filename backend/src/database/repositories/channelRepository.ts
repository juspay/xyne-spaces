import { BaseRepository } from './base';
import { Channel, ChannelScopeType, ChannelVisibility, ChannelType, ProjectType } from '@prisma/client';
import { QueryOptions } from '@/types/database';
import { logger } from '@/utils/logger';
import { formatDateTimeShort } from '@/utils/dateUtils';
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
  projectId?: string;
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
    const isDMChannel = data.scopeType === 'DM' || data.scopeType === 'GROUP_DM';
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


    return result;
  }

  /**
   * Queue channel for Vespa ingestion with complete data
   * Should be called AFTER participants are added to the channel
   */
  // async queueChannelForVespa(channelId: string, jobType: 'feed' | 'update' | 'delete'): Promise<void> {
  //   try {
  //     if (jobType === 'delete') {
  //       await queueChannelIngestion({ id: channelId }, jobType);
  //       return;
  //     }

  //     const channel = await this.findById(channelId);
  //     if (!channel) {
  //       throw new Error(`Channel not found: ${channelId}`);
  //     }

  //     // Fetch createdBy user's email
  //     const createdByUser = await this.db.user.findUnique({
  //       where: { id: channel.createdBy },
  //       select: { email: true }
  //     });

  //     // Fetch channel participants to include permissions and memberCount
  //     const channelParticipants = await this.db.channelParticipant.findMany({
  //       where: { channelId: channel.id }
  //     });

  //     // Extract user IDs for permissions
  //     const permissions = channelParticipants.map(p => p.userId);

  //     const channelWithAdditionalData = {
  //       ...channel,
  //       creator: createdByUser?.email, // Send user email in creator field
  //       // createdBy and ownerId will remain as user IDs (from channel object)
  //       permissions,
  //       memberCount: channelParticipants.length,
  //       lastActivityAt: channel.lastActivityAt || new Date(channel.createdAt),
  //       updatedAt: new Date(),
  //     };

  //     console.log(`[VESPA-FLOW] Channel ${channelId}: Final creator value being sent:`, channelWithAdditionalData.creator);
  //     console.log(`[VESPA-FLOW] Channel ${channelId}: Channel.createdBy:`, channel.createdBy);

  //     await queueChannelIngestion(channelWithAdditionalData, jobType);
  //   } catch (error) {
  //     console.error(`[VESPA-FLOW] Failed to queue channel for Vespa: ${channelId}`, error);
  //     // Don't throw - operation continues even if Vespa queuing fails
  //   }
  // }

  async findById(id: string): Promise<Channel | null> {
    return await this.db.channel.findUnique({
      where: { id }
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

    if (filters?.projectId) {
      where.projectId = filters.projectId;
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
      const isDMChannel = channel?.scopeType === 'DM' || channel?.scopeType === 'GROUP_DM';

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
    const result = await this.db.channel.delete({
      where: { id }
    });

    // Queue channel deletion from Vespa
    // await this.queueChannelForVespa(result.id, 'delete');

    return result;
  }

  // Channel-specific methods
  async updateLastActivity(id: string): Promise<void> {
    await this.db.channelStats.upsert({
      where: { channelId: id },
      update: { lastActivityAt: new Date() },
      create: { channelId: id, lastActivityAt: new Date() },
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

  async getChannelsByProject(projectId: string): Promise<Channel[]> {
    return await this.findMany({ projectId });
  }

  async getDMChannel(userId1: string, userId2: string): Promise<Channel | null> {
    // Self-DM: channel name is stored as single userId, scopeType DM
    if (userId1 === userId2) {
      return await this.db.channel.findFirst({
        where: { name: userId1, scopeType: ChannelScopeType.DM },
      });
    }
    // For 1:1 DM channels, name is sorted user IDs joined by comma
    const name = [userId1, userId2].sort().join(",");
    return await this.db.channel.findFirst({
      where: { name },
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

    if (filters?.projectId) {
      where.projectId = filters.projectId;
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
    // Get all GROUP_DM scope channels
    const name = memberIds.sort().join(",");
    return await this.db.channel.findFirst({
      where: {
        scopeType: 'GROUP_DM',
        name: name
      }
    });
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
   * falls back to creating a private DEFAULT channel to avoid the DB constraint.
   * @param userId - The ID of the user initiating the channel creation
   * @param invitedUserIds - Array of user IDs to include in the channel
   * @param channelParticipants - Channel participants repository for adding users
   * @param workspaceId - The workspace ID to get the DM project from
   * @param channelName - Optional friendly name override (e.g. scheduled call title)
   * @returns The channel ID (either existing or newly created)
   */
  async findOrCreateDMChannel(
    userId: string,
    invitedUserIds: string[],
    channelParticipants: any, // We'll pass this from the controller to avoid circular dependency
    workspaceId: string,
    channelName?: string
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

      dmChannel = await this.create({
        scopeType: ChannelScopeType.DM,
        name: dmChannelName,
        visibility: ChannelVisibility.PRIVATE,
        createdBy: userId,
        projectId,
        workspaceId,
      });

      // Add both users as participants
      await channelParticipants.addParticipant(dmChannel.id, userId, 'ADMIN', false);
      await channelParticipants.addParticipant(dmChannel.id, targetUserId, 'MEMBER', false);

      return dmChannel.id;
    }

    // Multiple users - create or find group DM channel
    const allUserIds = [userId, ...invitedUserIds].sort();
    const groupDmName = allUserIds.join(',');

    // If the name would exceed 255 chars (large groups, ~9+ members),
    // fall back to a private DEFAULT channel with a friendly name
    const isLargeGroup = groupDmName.length > 255;

    if (!isLargeGroup) {
      // Check if group DM already exists with these exact participants
      const existingGroupDM = await this.getGroupChannelByMembers(allUserIds);

      if (existingGroupDM) {
        return existingGroupDM.id;
      }

      // Create new group DM channel
      const groupDMChannel = await this.create({
        scopeType: ChannelScopeType.GROUP_DM,
        name: groupDmName,
        visibility: ChannelVisibility.PRIVATE,
        createdBy: userId,
        projectId,
        workspaceId,
      });

      // Add all users as participants
      await channelParticipants.addParticipant(groupDMChannel.id, userId, 'ADMIN', false);
      for (const invitedId of invitedUserIds) {
        await channelParticipants.addParticipant(groupDMChannel.id, invitedId, 'MEMBER', false);
      }

      return groupDMChannel.id;
    }

    // Large group: create a private DEFAULT channel
    // Use provided name, or generate a friendly human-readable name from the current time
    const now = new Date();
    const friendlyName = channelName
      ? `Call-${channelName}-${formatDateTimeShort(now)}`.slice(0, 254) // ensure it fits within 255 chars
      : `Call-${formatDateTimeShort(now)}`.slice(0, 254);

    // For large groups there won't be an existing channel to reuse (unique name),
    // so we always create a new one.
    const privateChannel = await this.create({
      scopeType: ChannelScopeType.DEFAULT,
      name: friendlyName,
      visibility: ChannelVisibility.PRIVATE,
      createdBy: userId,
      projectId,
      workspaceId,
    });

    // Add all users as participants
    await channelParticipants.addParticipant(privateChannel.id, userId, 'ADMIN', false);
    for (const invitedId of invitedUserIds) {
      await channelParticipants.addParticipant(privateChannel.id, invitedId, 'MEMBER', false);
    }

    return privateChannel.id;
  }

}
