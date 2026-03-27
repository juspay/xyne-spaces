import { repositories } from '../database/repositories/index';
import { aclService } from './aclService';
import { gcsService } from './gcsService';
import { AccessType, PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { DatabaseClient } from '@/database/client';
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
    await repositories.userGroups.validateNameUnique(data.name);
    return repositories.userGroups.create(data);
  }

  async getUserGroup(id: string): Promise<UserGroup | null> {
    return repositories.userGroups.findById(id);
  }

  async getUserGroupByName(name: string): Promise<UserGroup | null> {
    return repositories.userGroups.findByName(name);
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
      await repositories.userGroups.validateNameUnique(data.name, id);
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

  async getUserByEmail(email: string): Promise<User | null> {
    return repositories.users.findByEmail(email);
  }

  async getUserByProviderUserId(providerUserId: string): Promise<User | null> {
    return repositories.users.findByProviderUserId(providerUserId);
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
    accessType: AccessType
  ): Promise<{ success: boolean; message: string }> {
    return aclService.grantUserAccess(userId, resourceName, accessType);
  }

  /**
   * Grant resource access to a user group
   */
  async grantGroupResourceAccess(
    groupId: string,
    resourceName: string,
    accessType: AccessType
  ): Promise<{ success: boolean; message: string }> {
    return aclService.grantGroupAccess(groupId, resourceName, accessType);
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
    accessType: AccessType
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
        const result = await this.grantUserResourceAccess(userId, resourceName, accessType);
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
    accessType: AccessType
  ): Promise<{
    successful: string[];
    failed: { userId: string; error: string }[];
  }> {
    const users = await this.getUsersByGroup(groupId);
    const userIds = users.map(user => user.id);

    return this.bulkGrantUserAccess(userIds, resourceName, accessType);
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
        accessType: access.accessType,
        source: 'direct'
      });
    });

    // Add group access (only if not already present)
    groupAccess.forEach(access => {
      if (!resourceMap.has(access.resource.name)) {
        resourceMap.set(access.resource.name, {
          accessType: access.accessType,
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

      // Create new mapping
      await this.prisma.userGroupMapping.create({
        data: {
          userId,
          userGroupId: groupId
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
      const gcsResult = await gcsService.uploadFile(file.buffer, {
        filename: filePath,
        contentType: file.mimetype,
        metadata: {
          userId,
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      });

      // Store only the GCS path in database (not full URL)
      // Profile picture is served via streaming endpoint like custom emojis
      await this.prisma.user.update({
        where: { id: userId },
        data: { picture: gcsResult.gcsPath },
      });

      logger.info(`Profile picture uploaded for user ${userId}`, {
        filePath: gcsResult.gcsPath,
      });
      return gcsResult.gcsPath;
    } catch (error) {
      logger.error(`Error uploading profile picture for user ${userId}:`, error);
      throw error;
    }
  }

}
