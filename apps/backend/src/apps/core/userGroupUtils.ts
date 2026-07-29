import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { UserGroupResponse } from '../types';

/**
 * Get all user groups
 * 
 * @returns Array of user groups with id, name, alias, description, and member count
 */
export async function getAllUserGroups(): Promise<UserGroupResponse[]> {
  try {
    const userGroups = await repositories.userGroups.findMany({
      orderBy: { name: 'asc' },
    });

    // Get member counts for all groups
    const userGroupsWithCounts = await Promise.all(
      userGroups.map(async (group) => {
        const memberCount = await repositories.userGroups.getUserCount(group.id);
        
        return {
          id: group.id,
          name: group.name,
          alias: group.alias,
          description: group.description,
          isActive: group.isActive,
          memberCount,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        };
      })
    );

    return userGroupsWithCounts;
  } catch (error) {
    logger.error('[USERGROUP-UTILS] Error fetching user groups:', error);
    throw error;
  }
}
