import { DatabaseClient } from '@/database/client';
import { getContextOrNull } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import { assignmentReactivationQueue } from '@/queues/assignmentReactivationQueue';
import { redisService } from './redisService';
import type { UpdateUserPresenceInput } from '@/types/database';

export class UserAssignmentStateService {
  private readonly prisma = DatabaseClient.getInstance();

  /**
   * Get all user groups a user belongs to
   * @param userId - User ID
   */
  async getUserGroupIds(userId: string): Promise<string[]> {
    try {
      const mappings = await this.prisma.userGroupMapping.findMany({
        where: { userId },
        select: { userGroupId: true },
      });
      return mappings.map(m => m.userGroupId);
    } catch (error) {
      logger.error(`❌ [ASSIGNMENT-STATE] Error getting user group IDs:`, error);
      throw error;
    }
  }

  /**
   * Set user as unavailable for assignment (toggle ON)
   * Stores current state in Redis, sets all groups to inactive, and schedules restoration
   * @param userId - User ID
   * @param unavailableUntil - Timestamp when user will be available again
   */
  async setUnavailableForAssignment(
    userId: string,
    unavailableUntil: number
  ): Promise<string[]> {
    try {
      // Get all user groups the user belongs to
      const userGroupIds = await this.getUserGroupIds(userId);

      if (userGroupIds.length === 0) {
        logger.warn(`⚠️ [ASSIGNMENT-STATE] User ${userId} does not belong to any user groups`);
        return [];
      }

      // Get current assignment states for all groups
      const currentStates = await this.prisma.userAssignmentState.findMany({
        where: {
          userId,
          userGroupId: { in: userGroupIds },
        },
      });

      // Build state backup: only store groups where onCall === true OR isActiveForAssignment === true
      const stateBackup: Record<string, { onCall: boolean; isActiveForAssignment: boolean }> = {};
      
      for (const state of currentStates) {
        if (state.onCall || state.isActiveForAssignment) {
          stateBackup[state.userGroupId] = {
            onCall: state.onCall,
            isActiveForAssignment: state.isActiveForAssignment,
          };
        }
      }

      // Store backup in Redis (even if empty - we'll check on restore)
      await redisService.storeAssignmentStateBackup(userId, stateBackup);

      // Set all groups to inactive (onCall = false, isActiveForAssignment = false)
      // Only update if record exists - if no record exists, user won't get assignments anyway
      // (assignment engine treats missing records as inactive)
      await this.prisma.userAssignmentState.updateMany({
        where: {
          userId,
          userGroupId: { in: userGroupIds },
        },
        data: {
          isActiveForAssignment: false,
          onCall: false,
          updatedAt: new Date(),
        },
      });


      // Update UserPresence with assignmentUnavailableUntil
      // UserPresence should already exist (created during login via ensureUserPresence)
      await this.prisma.userPresence.update({
        where: { userId },
        data: {
          assignmentUnavailableUntil: new Date(unavailableUntil),
          updatedAt: new Date(),
        } as UpdateUserPresenceInput,
      });

      // Schedule restoration job (single job per user)
      await assignmentReactivationQueue.scheduleReactivation(userId, unavailableUntil);

      logger.info(
        `⏸️ [ASSIGNMENT-STATE] User ${userId} set unavailable for assignment in ${userGroupIds.length} group(s) until ${new Date(unavailableUntil).toISOString()}`
      );

      return userGroupIds;
    } catch (error) {
      logger.error(`❌ [ASSIGNMENT-STATE] Error setting user unavailable:`, error);
      throw error;
    }
  }

  /**
   * Set user as available for assignment (toggle OFF) when user manually removed the unavailability status
   * Restores original states from Redis backup, respecting manual overrides
   * @param userId - User ID
   */
  async setAvailableForAssignment(userId: string): Promise<string[]> {
    try {
      // Get all user groups the user belongs to
      const userGroupIds = await this.getUserGroupIds(userId);

      if (userGroupIds.length === 0) {
        logger.warn(`⚠️ [ASSIGNMENT-STATE] User ${userId} does not belong to any user groups`);
        return [];
      }

      // Get Redis backup
      const stateBackup = await redisService.getAssignmentStateBackup(userId);

      // Get current states (to check for manual overrides)
      const currentStates = await this.prisma.userAssignmentState.findMany({
        where: {
          userId,
          userGroupId: { in: userGroupIds },
        },
      });

      const currentStateMap = new Map(
        currentStates.map(s => [s.userGroupId, { onCall: s.onCall, isActiveForAssignment: s.isActiveForAssignment }])
      );

      // Denormalized tenant key for any newly-created state rows.
      const ws = getContextOrNull()?.workspaceId;
      if (!ws) {
        throw new Error('workspaceId required: no tenant context');
      }

      // Restore states from Redis backup.
      // - Only groups with active state (onCall or isActiveForAssignment) are stored in backup.
      // - If current state is active (manual override), keep it and skip backup restoration.
      // - Otherwise, restore from backup if available.
      const restorePromises = userGroupIds.map(userGroupId => {
        const backup = stateBackup?.[userGroupId];
        const current = currentStateMap.get(userGroupId);

        const hasManualOverride = current?.onCall || current?.isActiveForAssignment;

        if (hasManualOverride) {
          return Promise.resolve(null);
        }

        if (backup) {
          const restoredOnCall = backup.onCall;
          const restoredIsActiveForAssignment = Boolean(
            restoredOnCall || backup.isActiveForAssignment
          );

          if (current) {
            return this.prisma.userAssignmentState.update({
              where: {
                userId_userGroupId: {
                  userId,
                  userGroupId,
                },
              },
              data: {
                onCall: restoredOnCall,
                isActiveForAssignment: restoredIsActiveForAssignment,
                updatedAt: new Date(),
              },
            });
          } else {
            return this.prisma.userAssignmentState.create({
              data: {
                workspaceId: ws,
                userId,
                userGroupId,
                onCall: restoredOnCall,
                isActiveForAssignment: restoredIsActiveForAssignment,
                createdBy: userId,
              },
            });
          }
        }

        return Promise.resolve(null);
      });

      await Promise.all(restorePromises);

      // Clear assignmentUnavailableUntil in UserPresence
      await this.prisma.userPresence.update({
        where: { userId },
        data: {
          assignmentUnavailableUntil: null,
          updatedAt: new Date(),
        } as UpdateUserPresenceInput,
      });

      // Cancel any scheduled restoration job
      await assignmentReactivationQueue.cancelReactivation(userId);

      // Delete Redis backup
      await redisService.deleteAssignmentStateBackup(userId);

      logger.info(`▶️ [ASSIGNMENT-STATE] User ${userId} set available for assignment in ${userGroupIds.length} group(s)`);
      return userGroupIds;
    } catch (error) {
      logger.error(`❌ [ASSIGNMENT-STATE] Error setting user available:`, error);
      throw error;
    }
  }
}

export const userAssignmentStateService = new UserAssignmentStateService();
