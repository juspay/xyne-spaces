import { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { UserManagementService } from '../services/userManagementService';
import { getStorageService } from '../services/storage';
import { GuestEntity, AccessType, CalendarVisibility, WorkspaceRole, QuestionnaireType } from '@xyne/shared';
import { logger } from '../utils/logger';
import { setSafeInlineImageHeaders } from '../utils/safeAttachmentDownload';
import { DatabaseClient } from '@/database/client';
import type { UserWithMappings } from '../types/database';

const storageService = getStorageService();
const userManagementService = UserManagementService.getInstance();

/**
 * The row fields a user-search caller receives. Kept broad so existing consumers keep
 * working; `providerUserId` and `metadata` are held back — the first is the external
 * identity-provider subject, the second is free-form and not part of any caller's contract.
 */
function toUserSearchResult(user: UserWithMappings) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    displayName: user.displayName,
    status: user.status,
    userType: user.userType,
    authProvider: user.authProvider,
    workspaceId: user.workspaceId,
    role: user.role,
    orgMemberId: user.orgMemberId,
    leftAt: user.leftAt,
    statusEmoji: user.statusEmoji,
    statusContent: user.statusContent,
    statusExpiryAt: user.statusExpiryAt,
    lastActiveAt: user.lastActiveAt,
    notificationsPausedUntil: user.notificationsPausedUntil,
    assignmentUnavailableUntil: user.assignmentUnavailableUntil,
    calendarVisibility: user.calendarVisibility,
    userGroups: user.userGroupMappings.reduce((acc, mapping) => {
      if (mapping.userGroup) {
        acc.push({
          id: mapping.userGroup.id,
          name: mapping.userGroup.name,
          alias: mapping.userGroup.alias,
          description: mapping.userGroup.description,
        });
      }
      return acc;
    }, [] as Array<{ id: string; name: string; alias: string | null; description: string | null }>),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class UserManagementController {
  private static instance: UserManagementController;

  private constructor() {}

  public static getInstance(): UserManagementController {
    if (!UserManagementController.instance) {
      UserManagementController.instance = new UserManagementController();
    }
    return UserManagementController.instance;
  }

  /**
   * Get all users with pagination
   */
  getAllUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      // Validate pagination parameters
      if (limit < 1 || limit > 2000) {
        res.status(400).json({ error: 'Limit must be between 1 and 2000' });
        return;
      }

      if (offset < 0) {
        res.status(400).json({ error: 'Offset must be non-negative' });
        return;
      }

      // Use the dedicated method that includes group information
      const resultWithMappings = await userManagementService.getAllUsersWithMappings({
        page: Math.floor(offset / limit) + 1,
        pageSize: limit
      });

      if ('data' in resultWithMappings) {
        // Paginated result
        const response = {
          data: resultWithMappings.data.map(user => ({
            id: user.id,
            name: user.name,
            email: user.email,
            status: user.status,
            userGroups: user.userGroupMappings.reduce((acc, mapping) => {
              if (mapping.userGroup) {
                acc.push({
                  id: mapping.userGroup.id,
                  name: mapping.userGroup.name,
                  alias: mapping.userGroup.alias,
                  description: mapping.userGroup.description
                });
              }
              return acc;
            }, [] as Array<{ id: string; name: string; alias: string | null; description: string | null }>),
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
          })),
          pagination: resultWithMappings.pagination
        };
        res.status(200).json(response);
      } else {
        // Non-paginated result
        const response = {
          data: resultWithMappings.map(user => ({
            id: user.id,
            name: user.name,
            email: user.email,
            status: user.status,
            userGroups: user.userGroupMappings.reduce((acc, mapping) => {
              if (mapping.userGroup) {
                acc.push({
                  id: mapping.userGroup.id,
                  name: mapping.userGroup.name,
                  alias: mapping.userGroup.alias,
                  description: mapping.userGroup.description
                });
              }
              return acc;
            }, [] as Array<{ id: string; name: string; alias: string | null; description: string | null }>),
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
          })),
          pagination: {
            page: 1,
            pageSize: resultWithMappings.length,
            total: resultWithMappings.length,
            totalPages: 1,
          }
        };
        res.status(200).json(response);
      }
    } catch (error) {
      logger.error('Error getting all users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get user details by ID
   */
  getUserById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const user = await userManagementService.getUserWithMappings(id);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const response = {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        status: user.status,
        userGroups: user.userGroupMappings.reduce((acc, mapping) => {
          if (mapping.userGroup) {
            acc.push({
              id: mapping.userGroup.id,
              name: mapping.userGroup.name,
              alias: mapping.userGroup.alias,
              description: mapping.userGroup.description
            });
          }
          return acc;
        }, [] as Array<{ id: string; name: string; alias: string | null; description: string | null }>),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error getting user by ID:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getGuestUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (user.role !== WorkspaceRole.ADMIN && user.role !== WorkspaceRole.OWNER) {
        res.status(403).json({ error: 'Only workspace admins can manage guest users' });
        return;
      }

      const guests = await userManagementService.getWorkspaceGuestsWithAccess(user.workspaceId);
      res.status(200).json({ data: guests });
    } catch (error) {
      logger.error('Error getting guest users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  revokeGuestAccess = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (user.role !== WorkspaceRole.ADMIN && user.role !== WorkspaceRole.OWNER) {
        res.status(403).json({ error: 'Only workspace admins can manage guest users' });
        return;
      }

      const { userId, entityType, entityId } = req.params;
      if (!userId || !entityType || !entityId) {
        res.status(400).json({ error: 'Missing guest access target' });
        return;
      }

      if (!Object.values(GuestEntity).includes(entityType as GuestEntity)) {
        res.status(400).json({ error: 'Invalid guest entity type' });
        return;
      }

      const result = await userManagementService.revokeGuestEntityAccess({
        workspaceId: user.workspaceId,
        userId,
        accessibleEntityType: entityType as GuestEntity,
        accessibleEntityId: entityId,
      });

      if (!result.revoked) {
        res.status(404).json({ error: 'Guest access mapping not found' });
        return;
      }

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('Error revoking guest access:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get user access permissions
   */
  getUserAccess = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Check if user exists
      const user = await userManagementService.getUser(id);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const accessReport = await userManagementService.getUserAccessReport(id);

      res.status(200).json(accessReport);
    } catch (error) {
      logger.error('Error getting user access:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Update user access permissions
   */
  updateUserAccess = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { resourceAccess } = req.body;

      // Validate request body
      if (!Array.isArray(resourceAccess)) {
        res.status(400).json({ error: 'resourceAccess must be an array' });
        return;
      }

      // Check if user exists and belongs to the caller's workspace
      const user = await userManagementService.getUser(id);
      if (!user || user.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const results = {
        successful: [] as string[],
        failed: [] as { resourceName: string; error: string }[]
      };

      // Process each resource access update
      for (const access of resourceAccess) {
        const { resourceName, accessType, action } = access;

        if (!resourceName || !accessType || !action) {
          results.failed.push({
            resourceName: resourceName || 'unknown',
            error: 'Missing required fields: resourceName, accessType, action'
          });
          continue;
        }

        if (!Object.values(AccessType).includes(accessType)) {
          results.failed.push({
            resourceName,
            error: `Invalid access type: ${accessType}`
          });
          continue;
        }

        if (!['grant', 'revoke'].includes(action)) {
          results.failed.push({
            resourceName,
            error: `Invalid action: ${action}. Must be 'grant' or 'revoke'`
          });
          continue;
        }

        try {
          if (action === 'grant') {
            const result = await userManagementService.grantUserResourceAccess(
                id,
                resourceName,
                accessType,
                req.user!.workspaceId!
              );
            if (result.success) {
              results.successful.push(resourceName);
            } else {
              results.failed.push({ resourceName, error: result.message });
            }
          } else {
            const result = await userManagementService.revokeUserResourceAccess(
                id,
                resourceName
              );
            if (result.success) {
              results.successful.push(resourceName);
            } else {
              results.failed.push({ resourceName, error: result.message });
            }
          }
        } catch (error) {
          results.failed.push({
            resourceName,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      res.status(200).json({
        message: 'User access update completed',
        results
      });
    } catch (error) {
      logger.error('Error updating user access:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get all resources
   */
  getAllResources = async (_req: Request, res: Response): Promise<void> => {
    try {
      const resources = await userManagementService.getAllResources();

      const response = Array.isArray(resources) ? resources : resources.data;

      res.status(200).json({
        data: response.map(resource => ({
          id: resource.id,
          name: resource.name,
          description: resource.description,
          createdAt: resource.createdAt,
          updatedAt: resource.updatedAt
        }))
      });
    } catch (error) {
      logger.error('Error getting all resources:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Update user status (activate/deactivate)
   */
  updateUserStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !['ACTIVE', 'INACTIVE'].includes(status)) {
        res.status(400).json({ error: 'Invalid status. Must be ACTIVE or INACTIVE' });
        return;
      }

      // Ensure the target user belongs to the caller's workspace
      const targetUser = await userManagementService.getUser(id);
      if (!targetUser || targetUser.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const updatedUser = await userManagementService.updateUser(id, { status });

      res.status(200).json({
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        status: updatedUser.status,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt
      });
    } catch (error) {
      logger.error('Error updating user status:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: 'User not found' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };

  /**
   * Get current user's permissions
   */
  getCurrentUserPermissions = async (req: Request, res: Response): Promise<void> => {
    try {
      // Get the current user from the request (set by auth middleware)
      if (!req.user) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const userId = req.user.id;

      // Get user's resource access permissions
      const accessReport = await userManagementService.getUserAccessReport(userId);

      // Transform the combined permissions (both direct and group-inherited) for frontend consumption
      const permissions = accessReport.combinedResources.map(resource => ({
        resourceName: resource.resourceName,
        accessType: resource.accessType
      }));

      res.status(200).json({
        success: true,
        permissions
      });
    } catch (error) {
      logger.error('Error getting current user permissions:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error' 
      });
    }
  };

  getCurrentUserRoles = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }
      const roleIds = await userManagementService.getCurrentUserRoleIds(
        req.user.id,
        req.user.workspaceId,
      );
      res.status(200).json({ success: true, roleIds });
    } catch (error) {
      logger.error('Error getting current user roles:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * Search users
   */
  searchUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const { q } = req.query;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      if (!q || typeof q !== 'string') {
        res.status(400).json({ error: 'Search query (q) is required' });
        return;
      }

      const result = await userManagementService.searchUsers(q, {
        page: Math.floor(offset / limit) + 1,
        pageSize: limit
      });

      if ('data' in result) {
        // Paginated result
        const response = {
          data: result.data.map(toUserSearchResult),
          pagination: {
            page: result.pagination.page,
            pageSize: result.pagination.pageSize,
            total: result.pagination.total,
            totalPages: result.pagination.totalPages,
          }
        };
        res.status(200).json(response);
      } else {
        // Non-paginated result
        const response = {
          data: result.map(toUserSearchResult),
          pagination: {
            page: 1,
            pageSize: result.length,
            total: result.length,
            totalPages: 1,
          }
        };
        res.status(200).json(response);
      }
    } catch (error) {
      logger.error('Error searching users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // ==================== GROUP MANAGEMENT METHODS ====================

  /**
   * Get all user groups
   */
  getAllGroups = async (_req: Request, res: Response): Promise<void> => {
    try {
      const groups = await userManagementService.getAllUserGroupsWithCounts();

      const groupsArray = Array.isArray(groups) ? groups : groups.data;

      res.status(200).json({
        data: groupsArray.map((group: any) => ({
          id: group.id,
          name: group.name,
          alias: group.alias,
          description: group.description,
          userCount: group._count?.userGroupMappings || 0,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt
        }))
      });
    } catch (error) {
      logger.error('Error getting all groups:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get group details by ID
   */
  getGroupById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const group = await userManagementService.getUserGroupWithMappings(id);

      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      res.status(200).json({
        id: group.id,
        name: group.name,
        alias: group.alias,
        description: group.description,
        userCount: group.userGroupMappings?.length || 0,
        users: group.userGroupMappings?.map((mapping: any) => ({
          id: mapping.user.id,
          name: mapping.user.name,
          email: mapping.user.email,
          status: mapping.user.status
        })) || [],
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
      });
    } catch (error) {
      logger.error('Error getting group by ID:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Create a new user group
   */
  createGroup = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, alias, description } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Group name is required and must be a non-empty string' });
        return;
      }

      if (alias && typeof alias !== 'string') {
        res.status(400).json({ error: 'Alias must be a string' });
        return;
      }

      if (description && typeof description !== 'string') {
        res.status(400).json({ error: 'Description must be a string' });
        return;
      }

      const group = await userManagementService.createUserGroup({
        name: name.trim(),
        alias: alias?.trim() || null,
        description: description?.trim() || null,
        workspace: { connect: { id: req.user!.workspaceId! } }
      });

      res.status(201).json({
        id: group.id,
        name: group.name,
        alias: group.alias,
        description: group.description,
        userCount: 0,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
      });
    } catch (error) {
      logger.error('Error creating group:', error);
      if (error instanceof Error && error.message.includes('unique')) {
        res.status(400).json({ error: 'Group name already exists' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };

  /**
   * Update a user group
   */
  updateGroup = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { name, alias, description } = req.body;

      if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        res.status(400).json({ error: 'Group name must be a non-empty string' });
        return;
      }

      if (alias !== undefined && typeof alias !== 'string') {
        res.status(400).json({ error: 'Alias must be a string' });
        return;
      }

      if (description !== undefined && typeof description !== 'string') {
        res.status(400).json({ error: 'Description must be a string' });
        return;
      }

      // Ensure the target group belongs to the caller's workspace
      const existingGroup = await userManagementService.getUserGroup(id);
      if (!existingGroup || existingGroup.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const updateData: { name?: string; alias?: string | null; description?: string | null } = {};
      if (name !== undefined) updateData.name = name.trim();
      if (alias !== undefined) updateData.alias = alias?.trim() || null;
      if (description !== undefined) updateData.description = description?.trim() || null;

      const group = await userManagementService.updateUserGroup(id, updateData);

      res.status(200).json({
        id: group.id,
        name: group.name,
        alias: group.alias,
        description: group.description,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
      });
    } catch (error) {
      logger.error('Error updating group:', error);
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({ error: 'Group not found' });
        } else if (error.message.includes('unique')) {
          res.status(400).json({ error: 'Group name already exists' });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };

  /**
   * Delete a user group
   */
  deleteGroup = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Ensure the target group belongs to the caller's workspace
      const existingGroup = await userManagementService.getUserGroup(id);
      if (!existingGroup || existingGroup.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      await userManagementService.deleteUserGroup(id);

      res.status(200).json({ message: 'Group deleted successfully' });
    } catch (error) {
      logger.error('Error deleting group:', error);
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({ error: 'Group not found' });
        } else if (error.message.includes('Cannot delete')) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };

  /**
   * Deactivate a user group (soft delete)
   */
  deactivateGroup = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      await userManagementService.deactivateUserGroup(id);

      res.status(200).json({ message: 'Group deactivated successfully' });
    } catch (error) {
      logger.error('Error deactivating group:', error);
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({ error: 'Group not found' });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };

  /**
   * Reactivate a user group
   */
  reactivateGroup = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      await userManagementService.reactivateUserGroup(id);

      res.status(200).json({ message: 'Group reactivated successfully' });
    } catch (error) {
      logger.error('Error reactivating group:', error);
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({ error: 'Group not found' });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };

  /**
   * Assign user to group
   */
  assignUserToGroup = async (req: Request, res: Response): Promise<void> => {
    try {
      const { groupId, userId } = req.params;

      // Ensure both the target user and group belong to the caller's workspace
      const [targetUser, targetGroup] = await Promise.all([
        userManagementService.getUser(userId),
        userManagementService.getUserGroup(groupId),
      ]);
      if (!targetUser || targetUser.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (!targetGroup || targetGroup.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const result = await userManagementService.assignUserToGroup(userId, groupId);

      if (!result.success) {
        if (result.message.includes('not found')) {
          res.status(404).json({ error: result.message });
        } else {
          res.status(400).json({ error: result.message });
        }
        return;
      }

      res.status(200).json({ message: 'User assigned to group successfully' });
    } catch (error) {
      logger.error('Error assigning user to group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Remove user from group (assign to default group)
   */
  removeUserFromGroup = async (req: Request, res: Response): Promise<void> => {
    try {
      const { groupId, userId } = req.params;

      // Ensure both the target user and group belong to the caller's workspace
      const [targetUser, targetGroup] = await Promise.all([
        userManagementService.getUser(userId),
        userManagementService.getUserGroup(groupId),
      ]);
      if (!targetUser || targetUser.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (!targetGroup || targetGroup.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const result = await userManagementService.removeUserFromGroup(userId, groupId);

      if (!result.success) {
        if (result.message.includes('not found')) {
          res.status(404).json({ error: result.message });
        } else {
          res.status(400).json({ error: result.message });
        }
        return;
      }

      res.status(200).json({ message: 'User removed from group successfully' });
    } catch (error) {
      logger.error('Error removing user from group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // ==================== GROUP PERMISSION MANAGEMENT METHODS ====================

  /**
   * Get group permissions
   */
  getGroupPermissions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Check if group exists
      const group = await userManagementService.getUserGroup(id);
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const groupAccess = await userManagementService.getGroupAccess(id);

      res.status(200).json({
        group: {
          id: group.id,
          name: group.name,
          description: group.description
        },
        permissions: groupAccess.map(access => ({
          id: access.id,
          resourceName: access.resource.name,
          resourceDescription: access.resource.description,
          accessType: access.accessType,
          createdAt: access.createdAt,
          updatedAt: access.updatedAt
        }))
      });
    } catch (error) {
      logger.error('Error getting group permissions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Update group permissions
   */
  updateGroupPermissions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { permissions } = req.body;

      // Validate request body
      if (!Array.isArray(permissions)) {
        res.status(400).json({ error: 'permissions must be an array' });
        return;
      }

      // Check if group exists and belongs to the caller's workspace
      const group = await userManagementService.getUserGroup(id);
      if (!group || group.workspaceId !== req.user!.workspaceId) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const results = {
        successful: [] as string[],
        failed: [] as { resourceName: string; error: string }[]
      };

      // Process each permission update
      for (const permission of permissions) {
        const { resourceName, accessType, action } = permission;

        if (!resourceName || !accessType || !action) {
          results.failed.push({
            resourceName: resourceName || 'unknown',
            error: 'Missing required fields: resourceName, accessType, action'
          });
          continue;
        }

        if (!Object.values(AccessType).includes(accessType)) {
          results.failed.push({
            resourceName,
            error: `Invalid access type: ${accessType}`
          });
          continue;
        }

        if (!['grant', 'revoke'].includes(action)) {
          results.failed.push({
            resourceName,
            error: `Invalid action: ${action}. Must be 'grant' or 'revoke'`
          });
          continue;
        }

        try {
          if (action === 'grant') {
            const result = await userManagementService.grantGroupResourceAccess(
                id,
                resourceName,
                accessType,
                req.user!.workspaceId!
              );
            if (result.success) {
              results.successful.push(resourceName);
            } else {
              results.failed.push({ resourceName, error: result.message });
            }
          } else {
            const result = await userManagementService.revokeGroupResourceAccess(
                id,
                resourceName
              );
            if (result.success) {
              results.successful.push(resourceName);
            } else {
              results.failed.push({ resourceName, error: result.message });
            }
          }
        } catch (error) {
          results.failed.push({
            resourceName,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      res.status(200).json({
        message: 'Group permissions update completed',
        results
      });
    } catch (error) {
      logger.error('Error updating group permissions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Save the current user's questionnaire response.
   */
  saveQuestionnaireResponse = async (
    req: Request & { user?: { id: string; workspaceId?: string } },
    res: Response,
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { questionnaireType, payload } = req.body as {
        questionnaireType?: unknown;
        payload?: unknown;
      };

      if (typeof questionnaireType !== 'string' || !questionnaireType.trim()) {
        res.status(400).json({ error: 'questionnaireType is required' });
        return;
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        res.status(400).json({ error: 'payload must be an object' });
        return;
      }

      const type = questionnaireType.trim();
      const questionnairePayload = payload as Prisma.InputJsonValue;
      const prisma = DatabaseClient.getInstance();
      const normalizedEmail =
        type === QuestionnaireType.ONBOARDING
          ? (
              await prisma.user.findUnique({
                where: { id: userId },
                select: { email: true },
              })
            )?.email.toLowerCase().trim()
          : undefined;

      if (type === QuestionnaireType.ONBOARDING && !normalizedEmail) {
        res.status(400).json({ error: 'User email is required for onboarding questionnaire' });
        return;
      }

      if (type === QuestionnaireType.ONBOARDING) {
        const saved = await prisma.questionnaireResponse.upsert({
          where: {
            email_questionnaireType: {
              email: normalizedEmail!,
              questionnaireType: type,
            },
          },
          update: {
            workspaceId,
            userId,
            payload: questionnairePayload,
            updatedAt: new Date(),
          },
          create: {
            workspaceId,
            userId,
            email: normalizedEmail,
            questionnaireType: type,
            payload: questionnairePayload,
          },
        });

        res.status(200).json({
          id: saved.id,
          questionnaireType: saved.questionnaireType,
          payload: saved.payload,
        });
        return;
      }

      const saved = await prisma.questionnaireResponse.upsert({
        where: {
          workspaceId_questionnaireType_userId: {
            workspaceId,
            questionnaireType: type,
            userId,
          },
        },
        update: {
          payload: questionnairePayload,
          updatedAt: new Date(),
        },
        create: {
          workspaceId,
          userId,
          email: null,
          questionnaireType: type,
          payload: questionnairePayload,
        },
      });

      res.status(200).json({
        id: saved.id,
        questionnaireType: saved.questionnaireType,
        payload: saved.payload,
      });
    } catch (error) {
      logger.error('Error saving questionnaire response:', error);
      res.status(500).json({ error: 'Failed to save questionnaire response' });
    }
  };

  /**
   * Upload profile picture
   */
  uploadProfilePicture = async (req: Request & { user?: { id: string } }, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      // Validate file type
      const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
      if (!ALLOWED_TYPES.includes(file.mimetype)) {
        res.status(400).json({ error: 'Invalid file type. Only JPG, PNG, and WebP are allowed.' });
        return;
      }

      // Validate file size (max 5MB)
      const MAX_FILE_SIZE = 5 * 1024 * 1024;
      if (file.size > MAX_FILE_SIZE) {
        res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
        return;
      }

      // Use the userManagementService to upload picture
      const picturePath = await userManagementService.uploadProfilePicture(userId, file);

      res.status(200).json({ picture: picturePath });
    } catch (error) {
      logger.error('Error uploading profile picture:', error);
      res.status(500).json({ error: 'Failed to upload profile picture' });
    }
  };

  /**
   * Stream profile picture for a user
   * GET /api/users/:id/picture
   * 
   * Cache strategy mirrors emoji service:
   * - Picture path includes timestamp, so it changes with each upload
   * - Changed path = new URL = browser never has it cached
   * - Safe to use 1-year cache since URL changes = new content
   */
  streamProfilePicture = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const user = await userManagementService.getUser(id);

      if (!user?.picture) {
        res.status(404).json({ error: 'Profile picture not found' });
        return;
      }

      const gcsPath = user.picture;
      const fileExists = await storageService.fileExists(gcsPath);
      if (!fileExists) {
        res.status(404).json({ error: 'Profile picture file not found' });
        return;
      }

      const metadata = await storageService.getFileMetadata(gcsPath);
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      setSafeInlineImageHeaders(res, metadata.contentType || 'image/png');
      res.setHeader('Content-Length', fileSize);
      // Cache for 1 year - safe because picture path includes timestamp and changes on each upload
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      const stream = await storageService.createReadStream(gcsPath);
      stream.pipe(res);

      stream.on('error', (error: Error) => {
        logger.error('Stream error for profile picture:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream profile picture' });
        }
      });
    } catch (error) {
      logger.error('Error streaming profile picture:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream profile picture' });
      }
    }
  };

  /**
   * Upload voice signature audio and extract/store speaker embedding.
   * POST /api/users/me/voice-signature
   *
   * The audio file (WAV/OGG/MP3/WebM) is forwarded to the Python agent's
   * /embed-voice endpoint, which returns a 256-dim float32 embedding.
   * Only the 1024-byte packed embedding is persisted — the audio is discarded.
   */
  uploadVoiceSignature = async (req: Request & { user?: { id: string } }, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No audio file provided' });
        return;
      }

      const ALLOWED_AUDIO_TYPES = [
        'audio/wav', 'audio/wave', 'audio/x-wav',
        'audio/ogg', 'audio/mpeg', 'audio/mp3',
        'audio/webm', 'video/webm',  // browsers record webm
        'audio/mp4',
      ];
      if (!ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {
        res.status(400).json({ error: `Unsupported audio format: ${file.mimetype}` });
        return;
      }

      // 50 MB hard cap — a 30-second WAV at 48kHz 16-bit is ~2.8 MB
      const MAX_SIZE = 50 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        res.status(413).json({ error: 'Audio file too large (max 50 MB)' });
        return;
      }

      const result = await userManagementService.uploadVoiceSignature(userId, file);
      res.status(200).json(result);
    } catch (error) {
      logger.error('Error uploading voice signature:', error);
      res.status(500).json({ error: 'Failed to process voice signature' });
    }
  };

  /**
   * Delete voice signature for the current user.
   * DELETE /api/users/me/voice-signature
   */
  deleteVoiceSignature = async (req: Request & { user?: { id: string } }, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await userManagementService.deleteVoiceSignature(userId);
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('Error deleting voice signature:', error);
      res.status(500).json({ error: 'Failed to delete voice signature' });
    }
  };

  updateCalendarVisibility = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { visibility } = req.body;
      if (visibility !== CalendarVisibility.PUBLIC && visibility !== CalendarVisibility.PRIVATE) {
        res.status(400).json({ error: 'visibility must be PUBLIC or PRIVATE' });
        return;
      }
      await userManagementService.updateUser(userId, { calendarVisibility: visibility });
      res.json({ success: true, calendarVisibility: visibility });
    } catch (error) {
      logger.error('Error updating calendar visibility:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

}

export const userManagementController = UserManagementController.getInstance();
