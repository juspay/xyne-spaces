import { repositories } from '../database/repositories/index';
import { aclService } from './aclService';
import { getStorageService } from './storage';
import { PrismaClient } from '@prisma/client';
import { GuestEntity, AccessType, WorkspaceRole } from '@xyne/shared';
import { logger } from '../utils/logger';
import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import axios from 'axios';
import FormData from 'form-data';
import {
  User,
  UpdateUserInput,
  UserGroup,
  CreateUserGroupInput,
  UpdateUserGroupInput,
  Resource,
  CreateResourceInput,
  UpdateResourceInput,
  ResourceAccess,
  PaginationOptions,
  PaginatedResult,
  UserWithMappings,
  UserWithAccess,
  UserGroupWithMappings,
  ResourceAccessWithDetails,
} from '../types/database';
import { v4 as uuidv4 } from 'uuid';

/**
 * User Management Service
 *
 * Handles business logic for user groups, users, resources, and access control
 */
/**
 * Label for a guest grant whose target the *viewing admin* cannot read.
 *
 * Both lookups behind this screen run through the ACL'd client, so a grant on a channel the
 * admin is not a participant of (ChannelsACL: PUBLIC or participant) or on a canvas they
 * cannot reach (CanvasesACL) resolves to nothing. Naming the kind is deliberate: the admin
 * may revoke without being shown a private name, and 'Unknown entity' read like a data bug.
 */
function unresolvedEntityName(entityType: string): string {
  switch (entityType) {
    case GuestEntity.CHANNEL:
      return 'Private channel'
    case GuestEntity.CANVAS:
      return 'Private canvas'
    default:
      return 'Unknown entity'
  }
}

export class UserManagementService {
  private static instance: UserManagementService;
  private prisma: PrismaClient;

  private constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  public static getInstance(): UserManagementService {
    if (!UserManagementService.instance) {
      UserManagementService.instance = new UserManagementService();
    }
    return UserManagementService.instance;
  }

  // User Group Operations
  async createUserGroup(data: CreateUserGroupInput): Promise<UserGroup> {
    // Get workspaceId from the workspace relation for validation
    const workspaceId = (data.workspace as any)?.connect?.id;
    if (workspaceId) {
      await repositories.userGroups.validateNameUnique(data.name, workspaceId);
    }
    return repositories.userGroups.create(data);
  }

  async getUserGroup(id: string): Promise<UserGroup | null> {
    return repositories.userGroups.findById(id);
  }

  async getUserGroupByName(name: string, workspaceId: string): Promise<UserGroup | null> {
    return repositories.userGroups.findByName(name, workspaceId);
  }

  async getUserGroupWithMappings(id: string): Promise<UserGroupWithMappings | null> {
    return repositories.userGroups.findWithMappings(id);
  }

  async getAllUserGroups(options?: PaginationOptions): Promise<PaginatedResult<UserGroup> | UserGroup[]> {
    if (options) {
      return repositories.userGroups.findManyPaginated(options);
    }
    return repositories.userGroups.findMany({ orderBy: { name: 'asc' } });
  }

  async getAllUserGroupsWithCounts(options?: PaginationOptions): Promise<PaginatedResult<UserGroup & { _count: { userGroupMappings: number } }> | (UserGroup & { _count: { userGroupMappings: number } })[]> {
    try {
      if (!options) {
        // Return all groups without pagination but with user counts
        const groups = await this.prisma.userGroup.findMany({
          orderBy: {
            name: 'asc'
          }
        });

        if (groups.length === 0) {
          return [];
        }

        // Get counts for all fetched groups in a single query
        const groupIds = groups.map(g => g.id);
        const counts = await this.prisma.userGroupMapping.groupBy({
          by: ['userGroupId'],
          where: { userGroupId: { in: groupIds } },
          _count: { userGroupId: true }
        });

        const countMap = new Map(counts.map(c => [c.userGroupId, c._count.userGroupId]));

        const groupsWithCounts = groups.map(group => ({
          ...group,
          _count: { userGroupMappings: countMap.get(group.id) || 0 }
        }));

        return groupsWithCounts;
      }

      const { page, pageSize } = options;
      const offset = (page - 1) * pageSize;

      // Get total count for pagination
      const totalCount = await this.prisma.userGroup.count();

      // Get groups with pagination
      const groups = await this.prisma.userGroup.findMany({
        skip: offset,
        take: pageSize,
        orderBy: {
          name: 'asc'
        }
      });

      if (groups.length === 0) {
        return {
          data: [],
          pagination: { page, pageSize, total: totalCount, totalPages: 0 }
        };
      }

      // Get counts for all fetched groups in a single query
      const groupIds = groups.map(g => g.id);
      const counts = await this.prisma.userGroupMapping.groupBy({
        by: ['userGroupId'],
        where: { userGroupId: { in: groupIds } },
        _count: { userGroupId: true }
      });

      const countMap = new Map(counts.map(c => [c.userGroupId, c._count.userGroupId]));

      const groupsWithCounts = groups.map(group => ({
        ...group,
        _count: { userGroupMappings: countMap.get(group.id) || 0 }
      }));

      // Calculate pagination info
      const totalPages = Math.ceil(totalCount / pageSize);

      return {
        data: groupsWithCounts,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages
        }
      };
    } catch (error) {
      logger.error('Error getting all user groups with counts:', error);
      throw new Error('Failed to get user groups with counts');
    }
  }

  async updateUserGroup(id: string, data: UpdateUserGroupInput): Promise<UserGroup> {
    if (data.name && typeof data.name === 'string') {
      // Get the existing group to obtain workspaceId for validation
      const existingGroup = await repositories.userGroups.findById(id);
      if (existingGroup) {
        await repositories.userGroups.validateNameUnique(data.name, existingGroup.workspaceId, id);
      }
    }
    return repositories.userGroups.update(id, data);
  }

  async deleteUserGroup(id: string): Promise<UserGroup> {
    // Check if group has users
    const userCount = await repositories.userGroups.getUserCount(id);
    if (userCount > 0) {
      throw new Error('Cannot delete user group that has users assigned to it');
    }
    return repositories.userGroups.delete(id);
  }

  async deactivateUserGroup(id: string): Promise<UserGroup> {
    return repositories.userGroups.softDelete(id);
  }

  async reactivateUserGroup(id: string): Promise<UserGroup> {
    return repositories.userGroups.restore(id);
  }

  async searchUserGroups(searchTerm: string, options?: PaginationOptions): Promise<PaginatedResult<UserGroup> | UserGroup[]> {
    return repositories.userGroups.findBySearch(searchTerm, options);
  }

  // User Operations - simplified to use repository layer directly
  async getUser(id: string): Promise<User | null> {
    return repositories.users.findById(id);
  }

  async getUserByEmail(email: string, workspaceId: string): Promise<User | null> {
    return repositories.users.findByEmail(email, workspaceId);
  }

  async getUserByProviderUserId(providerUserId: string, workspaceId: string): Promise<User | null> {
    return repositories.users.findByProviderUserId(providerUserId, workspaceId);
  }

  async getUserWithMappings(id: string): Promise<UserWithMappings | null> {
    return repositories.users.findWithMappings(id);
  }

  async getUserWithAccess(id: string): Promise<UserWithAccess | null> {
    return repositories.users.findWithAccess(id);
  }

  async getAllUsers(options?: PaginationOptions): Promise<PaginatedResult<User> | User[]> {
    if (options) {
      return repositories.users.findManyPaginated(options);
    }
    return repositories.users.findMany({ orderBy: { email: 'asc' } });
  }

  /**
   * Get all users with their group information and pagination support
   */
  async getAllUsersWithMappings(options?: PaginationOptions): Promise<PaginatedResult<UserWithMappings> | UserWithMappings[]> {
    try {
      if (!options) {
        // Return all users without pagination
        const users = await this.prisma.user.findMany({
          orderBy: {
            createdAt: 'desc'
          }
        });

        if (users.length === 0) {
          return [];
        }

        const userIds = users.map(u => u.id);

        // Fetch all mappings for these users in one query
        const mappings = await this.prisma.userGroupMapping.findMany({
          where: { userId: { in: userIds } }
        });

        const groupIds = [...new Set(mappings.map(m => m.userGroupId))];

        // Fetch all relevant groups in one query
        const groups = groupIds.length > 0
          ? await this.prisma.userGroup.findMany({ where: { id: { in: groupIds } } })
          : [];

        const groupMap = new Map(groups.map(g => [g.id, g]));

        // Build a map of mappings per user for efficient lookup
        const mappingsByUser = new Map();
        mappings.forEach(mapping => {
          const userMappings = mappingsByUser.get(mapping.userId) || [];
          userMappings.push({
            ...mapping,
            userGroup: groupMap.get(mapping.userGroupId) || null
          });
          mappingsByUser.set(mapping.userId, userMappings);
        });

        // Combine user data with their mappings
        const usersWithMappings = users.map(user => ({
          ...user,
          userGroupMappings: mappingsByUser.get(user.id) || []
        }));

        return usersWithMappings as UserWithMappings[];
      }

      const { page, pageSize } = options;
      const offset = (page - 1) * pageSize;

      // Get total count for pagination
      const totalCount = await this.prisma.user.count();

      // Get users with pagination
      const users = await this.prisma.user.findMany({
        skip: offset,
        take: pageSize,
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (users.length === 0) {
        return {
          data: [],
          pagination: { page, pageSize, total: totalCount, totalPages: 0 }
        };
      }

      const userIds = users.map(u => u.id);

      // Fetch all mappings for these users in one query
      const mappings = await this.prisma.userGroupMapping.findMany({
        where: { userId: { in: userIds } }
      });

      const groupIds = [...new Set(mappings.map(m => m.userGroupId))];

      // Fetch all relevant groups in one query
      const groups = groupIds.length > 0
        ? await this.prisma.userGroup.findMany({ where: { id: { in: groupIds } } })
        : [];

      const groupMap = new Map(groups.map(g => [g.id, g]));

      // Build a map of mappings per user for efficient lookup
      const mappingsByUser = new Map();
      mappings.forEach(mapping => {
        const userMappings = mappingsByUser.get(mapping.userId) || [];
        userMappings.push({
          ...mapping,
          userGroup: groupMap.get(mapping.userGroupId) || null
        });
        mappingsByUser.set(mapping.userId, userMappings);
      });

      // Combine user data with their mappings
      const usersWithMappings = users.map(user => ({
        ...user,
        userGroupMappings: mappingsByUser.get(user.id) || []
      }));

      // Calculate pagination info
      const totalPages = Math.ceil(totalCount / pageSize);

      return {
        data: usersWithMappings as UserWithMappings[],
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages
        }
      };
    } catch (error) {
      logger.error('Error getting all users with groups:', error);
      throw new Error('Failed to get users with groups');
    }
  }

  async getUsersByGroup(userGroupId: string): Promise<User[]> {
    return repositories.users.findByUserGroup(userGroupId);
  }

  async getActiveUsers(): Promise<User[]> {
    return repositories.users.findActiveUsers();
  }

  async updateUser(id: string, data: UpdateUserInput): Promise<User> {
    if (data.email && typeof data.email === 'string') {
      await repositories.users.validateEmailUnique(data.email, id);
    }
    if (data.name && typeof data.name === 'string') {
      await repositories.users.validateString(data.name, 'name', 255);
    }
    if (data.providerUserId && typeof data.providerUserId === 'string') {
      await repositories.users.validateProviderUserIdUnique(data.providerUserId, id);
    }

    return repositories.users.update(id, data);
  }

  async deleteUser(id: string): Promise<User> {
    return repositories.users.delete(id);
  }

  async searchUsers(searchTerm: string, options?: PaginationOptions): Promise<PaginatedResult<UserWithMappings> | UserWithMappings[]> {
    return repositories.users.findBySearch(searchTerm, options);
  }

  async getWorkspaceGuestsWithAccess(workspaceId: string): Promise<Array<{
    id: string;
    name: string;
    email: string;
    picture: string | null;
    status: string;
    createdAt: Date;
    access: Array<{
      id: string;
      accessibleEntityId: string;
      accessibleEntityType: string;
      entityName: string;
      createdAt: Date;
      invitedBy: string;
      invitedByName: string | null;
    }>;
  }>> {
    const mappings = await this.prisma.guestAccess.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });

    if (mappings.length === 0) {
      return [];
    }

    const userIds = [...new Set(mappings.map(mapping => mapping.userId))];
    const inviterIds = [...new Set(mappings.map(mapping => mapping.invitedBy))];
    const users = await this.prisma.user.findMany({
      where: {
        workspaceId,
        id: { in: [...new Set([...userIds, ...inviterIds])] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        picture: true,
        status: true,
        role: true,
        createdAt: true,
      },
    });

    const guestUsers = users.filter(user => user.role === WorkspaceRole.GUEST);
    const guestUserMap = new Map(guestUsers.map(user => [user.id, user]));
    const userMap = new Map(users.map(user => [user.id, user]));

    const channelIds = mappings
      .filter(mapping => mapping.accessibleEntityType === GuestEntity.CHANNEL)
      .map(mapping => mapping.accessibleEntityId);
    const canvasIds = mappings
      .filter(mapping => mapping.accessibleEntityType === GuestEntity.CANVAS)
      .map(mapping => mapping.accessibleEntityId);

    const [channels, canvases] = await Promise.all([
      channelIds.length
        ? this.prisma.channel.findMany({
            where: { workspaceId, id: { in: [...new Set(channelIds)] } },
            select: { id: true, name: true },
          })
        : [],
      canvasIds.length
        ? this.prisma.canvas.findMany({
            where: { id: { in: [...new Set(canvasIds)] } },
            select: { id: true, title: true },
          })
        : [],
    ]);

    const channelNameById = new Map(channels.map(channel => [channel.id, channel.name]));
    const canvasTitleById = new Map(canvases.map(canvas => [canvas.id, canvas.title]));
    const accessByUserId = new Map<string, Array<{
      id: string;
      accessibleEntityId: string;
      accessibleEntityType: string;
      entityName: string;
      createdAt: Date;
      invitedBy: string;
      invitedByName: string | null;
    }>>();

    for (const mapping of mappings) {
      if (!guestUserMap.has(mapping.userId)) continue;
      const entityName =
        mapping.accessibleEntityType === GuestEntity.CHANNEL
          ? channelNameById.get(mapping.accessibleEntityId)
          : canvasTitleById.get(mapping.accessibleEntityId);
      const access = accessByUserId.get(mapping.userId) ?? [];
      access.push({
        id: mapping.id,
        accessibleEntityId: mapping.accessibleEntityId,
        accessibleEntityType: mapping.accessibleEntityType,
        entityName: entityName ?? unresolvedEntityName(mapping.accessibleEntityType),
        createdAt: mapping.createdAt,
        invitedBy: mapping.invitedBy,
        invitedByName: userMap.get(mapping.invitedBy)?.name ?? null,
      });
      accessByUserId.set(mapping.userId, access);
    }

    return guestUsers
      .map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        status: user.status,
        createdAt: user.createdAt,
        access: accessByUserId.get(user.id) ?? [],
      }))
      .filter(user => user.access.length > 0)
      .sort((left, right) => left.email.localeCompare(right.email));
  }

  async revokeGuestEntityAccess(params: {
    workspaceId: string;
    userId: string;
    accessibleEntityType: GuestEntity;
    accessibleEntityId: string;
  }): Promise<{ revoked: boolean }> {
    const guestUser = await this.prisma.user.findFirst({
      where: {
        id: params.userId,
        workspaceId: params.workspaceId,
        role: WorkspaceRole.GUEST,
      },
      select: { id: true },
    });

    if (!guestUser) {
      return { revoked: false };
    }

    return this.prisma.$transaction(async tx => {
      const deleted = await tx.guestAccess.deleteMany({
        where: {
          workspaceId: params.workspaceId,
          userId: params.userId,
          accessibleEntityType: params.accessibleEntityType,
          accessibleEntityId: params.accessibleEntityId,
        },
      });

      if (deleted.count === 0) {
        return { revoked: false };
      }

      if (params.accessibleEntityType === GuestEntity.CHANNEL) {
        await tx.channelParticipant.deleteMany({
          where: { channelId: params.accessibleEntityId, userId: params.userId },
        });
        await tx.channelUserStatus.deleteMany({
          where: { channelId: params.accessibleEntityId, userId: params.userId },
        });
      }

      if (params.accessibleEntityType === GuestEntity.CANVAS) {
        await tx.canvasParticipant.deleteMany({
          where: { canvasId: params.accessibleEntityId, userId: params.userId },
        });
      }

      return { revoked: true };
    });
  }

  // Resource Operations
  async createResource(data: CreateResourceInput): Promise<Resource> {
    await repositories.resources.validateNameUnique(data.name);
    return repositories.resources.create(data);
  }

  async getResource(id: string): Promise<Resource | null> {
    return repositories.resources.findById(id);
  }

  async getResourceByName(name: string): Promise<Resource | null> {
    return repositories.resources.findByName(name);
  }

  async getAllResources(options?: PaginationOptions): Promise<PaginatedResult<Resource> | Resource[]> {
    if (options) {
      return repositories.resources.findManyPaginated(options);
    }
    return repositories.resources.findMany({ orderBy: { name: 'asc' } });
  }

  async updateResource(id: string, data: UpdateResourceInput): Promise<Resource> {
    if (data.name && typeof data.name === 'string') {
      await repositories.resources.validateNameUnique(data.name, id);
    }
    return repositories.resources.update(id, data);
  }

  async deleteResource(id: string): Promise<Resource> {
    const accessCount = await repositories.resources.getAccessCount(id);
    if (accessCount > 0) {
      throw new Error('Cannot delete resource that has access permissions assigned to it');
    }
    return repositories.resources.delete(id);
  }

  async searchResources(searchTerm: string, options?: PaginationOptions): Promise<PaginatedResult<Resource> | Resource[]> {
    return repositories.resources.findBySearch(searchTerm, options);
  }

  // Resource Access Operations - simplified to use repositories directly
  async revokeAccess(id: string): Promise<ResourceAccess> {
    return repositories.resourceAccess.delete(id);
  }

  async revokeUserAccess(userId: string, resourceId: string): Promise<void> {
    return repositories.resourceAccess.revokeUserAccess(userId, resourceId);
  }

  async revokeGroupAccess(groupId: string, resourceId: string): Promise<void> {
    return repositories.resourceAccess.revokeGroupAccess(groupId, resourceId);
  }

  async getResourceAccess(resourceId: string): Promise<ResourceAccessWithDetails[]> {
    return repositories.resourceAccess.findByResource(resourceId);
  }

  async getUserAccess(userId: string): Promise<ResourceAccessWithDetails[]> {
    return repositories.resourceAccess.findAllUserAccess(userId);
  }

  async getGroupAccess(groupId: string): Promise<ResourceAccessWithDetails[]> {
    return repositories.resourceAccess.findByGroup(groupId);
  }

  // ACL Integration Methods

  /**
   * Grant resource access to a user
   */
  async grantUserResourceAccess(
    userId: string,
    resourceName: string,
    accessType: AccessType,
    workspaceId: string
  ): Promise<{ success: boolean; message: string }> {
    return aclService.grantUserAccess(userId, resourceName, accessType, workspaceId);
  }

  /**
   * Grant resource access to a user group
   */
  async grantGroupResourceAccess(
    groupId: string,
    resourceName: string,
    accessType: AccessType,
    workspaceId: string
  ): Promise<{ success: boolean; message: string }> {
    return aclService.grantGroupAccess(groupId, resourceName, accessType, workspaceId);
  }

  /**
   * Revoke resource access from a user
   */
  async revokeUserResourceAccess(
    userId: string,
    resourceName: string
  ): Promise<{ success: boolean; message: string }> {
    return aclService.revokeUserAccess(userId, resourceName);
  }

  /**
   * Revoke resource access from a user group
   */
  async revokeGroupResourceAccess(
    groupId: string,
    resourceName: string
  ): Promise<{ success: boolean; message: string }> {
    return aclService.revokeGroupAccess(groupId, resourceName);
  }

  /**
   * Bulk grant access to multiple users for a resource
   */
  async bulkGrantUserAccess(
    userIds: string[],
    resourceName: string,
    accessType: AccessType,
    workspaceId: string
  ): Promise<{
    successful: string[];
    failed: { userId: string; error: string }[];
  }> {
    const results = {
      successful: [] as string[],
      failed: [] as { userId: string; error: string }[]
    };

    for (const userId of userIds) {
      try {
        const result = await this.grantUserResourceAccess(userId, resourceName, accessType, workspaceId);
        if (result.success) {
          results.successful.push(userId);
        } else {
          results.failed.push({ userId, error: result.message });
        }
      } catch (error) {
        results.failed.push({
          userId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * Bulk grant access to all users in a group for a resource
   */
  async grantGroupUsersAccess(
    groupId: string,
    resourceName: string,
    accessType: AccessType,
    workspaceId: string
  ): Promise<{
    successful: string[];
    failed: { userId: string; error: string }[];
  }> {
    const users = await this.getUsersByGroup(groupId);
    const userIds = users.map(user => user.id);

    return this.bulkGrantUserAccess(userIds, resourceName, accessType, workspaceId);
  }

  /**
   * Get comprehensive access report for a user
   */
  async getUserAccessReport(userId: string): Promise<{
    user: User | null;
    directAccess: ResourceAccessWithDetails[];
    groupAccess: ResourceAccessWithDetails[];
    combinedResources: {
      resourceName: string;
      accessType: AccessType;
      source: 'direct' | 'group';
    }[];
  }> {
    const user = await this.getUser(userId);
    if (!user) {
      return {
        user: null,
        directAccess: [],
        groupAccess: [],
        combinedResources: []
      };
    }

    const directAccess = await repositories.resourceAccess.findByUser(userId);

    // Get group access from all user's groups via mappings
    let groupAccess: ResourceAccessWithDetails[] = [];
    const userWithMappings = await repositories.users.findWithMappings(userId);
    if (userWithMappings && Array.isArray(userWithMappings.userGroupMappings) && userWithMappings.userGroupMappings.length > 0) {
      // Get access for all groups the user belongs to in a single batch query
      const groupIds = userWithMappings.userGroupMappings.map(m => m.userGroupId);
      groupAccess = await this.prisma.resourceAccess.findMany({
        where: { groupId: { in: groupIds } },
        include: {
          userGroup: true,
          user: true,
          resource: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Combine and deduplicate resources
    const resourceMap = new Map<string, { accessType: AccessType; source: 'direct' | 'group' }>();

    // Add direct access (higher priority)
    directAccess.forEach(access => {
      resourceMap.set(access.resource.name, {
        accessType: access.accessType as AccessType,
        source: 'direct'
      });
    });

    // Add group access (only if not already present)
    groupAccess.forEach(access => {
      if (!resourceMap.has(access.resource.name)) {
        resourceMap.set(access.resource.name, {
          accessType: access.accessType as AccessType,
          source: 'group'
        });
      }
    });

    const combinedResources = Array.from(resourceMap.entries()).map(([resourceName, details]) => ({
      resourceName,
      accessType: details.accessType,
      source: details.source
    }));

    return {
      user,
      directAccess,
      groupAccess,
      combinedResources
    };
  }

  async getCurrentUserRoleIds(userId: string, workspaceId: string): Promise<string[]> {
    const [directMappings, groupMappings] = await Promise.all([
      this.prisma.userRoleMapping.findMany({
        where: { userId, role: { workspaceId, isActive: true } },
        select: { roleId: true },
      }),
      this.prisma.userGroupMapping.findMany({
        where: { userId, roleId: { not: null }, role: { workspaceId, isActive: true } },
        select: { roleId: true },
      }),
    ]);
    const roleIds = new Set<string>();
    for (const m of directMappings) roleIds.add(m.roleId);
    for (const m of groupMappings) if (m.roleId) roleIds.add(m.roleId);
    return Array.from(roleIds);
  }

  // User Group Assignment Operations

  /**
   * Assign user to a group
   */
  async assignUserToGroup(userId: string, groupId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Verify user exists
      const user = await this.getUser(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // Verify group exists
      const group = await this.getUserGroup(groupId);
      if (!group) {
        return { success: false, message: 'Group not found' };
      }

      // Check if user is already in this group
      const existingMapping = await this.prisma.userGroupMapping.findUnique({
        where: {
          userId_userGroupId: {
            userId,
            userGroupId: groupId
          }
        }
      });

      if (existingMapping) {
        return { success: false, message: 'User is already in this group' };
      }

      // Create new mapping. Use the GROUP's workspace (the mapping belongs to the
      // group's tenant), not user.workspaceId — users are multi-workspace and their
      // workspaceId is only their home workspace, which would mis-scope/hide the
      // mapping when assigning to a group in another workspace.
      await this.prisma.userGroupMapping.create({
        data: {
          userId,
          userGroupId: groupId,
          workspaceId: group.workspaceId,
        }
      });

      return { success: true, message: `User assigned to group ${group.name}` };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Remove user from group
   */
  async removeUserFromGroup(userId: string, groupId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Verify user exists
      const user = await this.getUser(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // Find and delete the mapping
      const mapping = await this.prisma.userGroupMapping.findUnique({
        where: {
          userId_userGroupId: {
            userId,
            userGroupId: groupId
          }
        }
      });

      if (!mapping) {
        return { success: false, message: 'User is not in this group' };
      }

      await this.prisma.userGroupMapping.delete({
        where: {
          userId_userGroupId: {
            userId,
            userGroupId: groupId
          }
        }
      });

      return { success: true, message: 'User removed from group.' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Upload profile picture for a user
   */
  async uploadProfilePicture(userId: string, file: Express.Multer.File): Promise<string> {
    try {
      // Generate file path with timestamp and uuid for uniqueness
      const timestamp = Date.now();
      const uuid = uuidv4();
      const filename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `profile-pictures/${userId}/${timestamp}-${uuid}-${filename}`;

      // Upload to GCS
      const uploadResult = await getStorageService().uploadFile(file.buffer, {
        filename: filePath,
        contentType: file.mimetype,
        metadata: {
          userId,
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      });

      // Store only the storage path in database (not full URL)
      // Profile picture is served via streaming endpoint like custom emojis
      await this.prisma.user.update({
        where: { id: userId },
        data: { picture: uploadResult.path },
      });

      logger.info(`Profile picture uploaded for user ${userId}`, {
        filePath: uploadResult.path,
      });
      return uploadResult.path;
    } catch (error) {
      logger.error(`Error uploading profile picture for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Extract a speaker embedding from an audio file and store it as the user's voice signature.
   *
   * Flow:
   *  1. Forward the raw audio buffer to the Python agent's /embed-voice endpoint.
   *  2. Receive back a 256-element float32 array (the voiceprint embedding).
   *  3. Pack the floats into a 1024-byte Buffer (IEEE-754 float32 little-endian).
   *  4. Store those bytes in user_profiles.voiceSignature — the audio itself is never persisted.
   *
   * @returns ISO timestamp string of when the signature was stored
   */
  async uploadVoiceSignature(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ hasVoiceSignature: boolean }> {
    try {
      // ── 1. Forward audio to Python embed service ──────────────────────────
      const pythonAgentUrl = config.pythonAgentUrl;
      if (!pythonAgentUrl) {
        throw new Error('PYTHON_AGENT_URL is not configured');
      }

      const form = new FormData();
      form.append('audio', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype,
      });

      const embedResponse = await axios.post<{ embedding: number[]; dim: number }>(
        `${pythonAgentUrl}/embed-voice`,
        form,
        {
          headers: form.getHeaders(),
          timeout: 60_000, // 60s — model loading + inference can be slow on first call
        },
      );

      const { embedding } = embedResponse.data;
      if (!Array.isArray(embedding) || embedding.length !== 256) {
        throw new Error(
          `Invalid embedding from Python service: expected 256 floats, got ${embedding?.length}`,
        );
      }

      // ── 2. Pack floats → 1024-byte Buffer (float32 LE) ───────────────────
      const buffer = Buffer.allocUnsafe(256 * 4);
      for (let i = 0; i < 256; i++) {
        buffer.writeFloatLE(embedding[i]!, i * 4);
      }

      // ── 3. Upsert into user_profiles ──────────────────────────────────────
      const user = await this.getUser(userId);
      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      await this.prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          voiceSignature: buffer,
          hasVoiceSignature: true,
          workspaceId: user.workspaceId,
        },
        update: {
          voiceSignature: buffer,
          hasVoiceSignature: true,
        },
      });

      logger.info(`Voice signature stored for user ${userId} (1024 bytes)`);
      return { hasVoiceSignature: true };
    } catch (error) {
      let msg = error instanceof Error ? error.message : String(error);
      // Surface axios response body for easier debugging
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const body = error.response?.data;
        const detail = body?.detail ? `\n${body.detail}` : '';
        const errMsg = body?.error ?? error.code ?? error.message;
        msg = `Python agent request failed (${status ?? error.code}): ${errMsg}${detail}`;
      }
      logger.error(`Error storing voice signature for user ${userId}: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Delete voice signature for the current user.
   */
  async deleteVoiceSignature(userId: string): Promise<void> {
    await this.prisma.userProfile.updateMany({
      where: { userId },
      data: {
        voiceSignature: null,
        hasVoiceSignature: false,
      },
    });
    logger.info(`Voice signature deleted for user ${userId}`);
  }

}
