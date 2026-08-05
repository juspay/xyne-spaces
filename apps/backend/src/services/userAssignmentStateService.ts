import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { assignmentReactivationQueue } from '@/queues/assignmentReactivationQueue';
import { ticketReassignmentQueue } from '@/queues/ticketReassignmentQueue';
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
      return mappings.map((m) => m.userGroupId);
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
   * @param reassignExistingTickets - Whether to hand off current open tickets for this pause
   */
  async setUnavailableForAssignment(
    userId: string,
    unavailableUntil: number,
    reassignExistingTickets = false
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

      // Pausing always excludes the user from new auto-assignment. Existing tickets are
      // only handed off when the user requests it for this pause and the group's admin
      // configuration permits it.
      const reassignGroups = reassignExistingTickets
        ? await this.prisma.userGroup.findMany({
            where: { id: { in: userGroupIds }, reassignOnUnavailable: true },
            select: { id: true },
          })
        : [];

      for (const group of reassignGroups) {
        try {
          await ticketReassignmentQueue.scheduleReassignment(userId, group.id);
        } catch (error) {
          logger.error(
            `❌ [ASSIGNMENT-STATE] Failed to schedule ticket reassignment for user ${userId} in group ${group.id}:`,
            error
          );
        }
      }

      logger.info(
        `⏸️ [ASSIGNMENT-STATE] User ${userId} set unavailable for assignment in ${userGroupIds.length} group(s) until ${new Date(unavailableUntil).toISOString()}${reassignGroups.length ? `; queued reassignment for ${reassignGroups.length} group(s)` : ''}`
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
        currentStates.map((s) => [
          s.userGroupId,
          { onCall: s.onCall, isActiveForAssignment: s.isActiveForAssignment },
        ])
      );

      // Denormalized tenant key for any newly-created state rows. Resolve each
      // group's workspace directly from the UserGroup: reactivation runs in a
      // background worker with no ambient tenant context, so getContextOrNull()
      // would be null here (and a user can belong to groups in different
      // workspaces, so a single ambient workspaceId would be wrong anyway).
      const groups = await this.prisma.userGroup.findMany({
        where: { id: { in: userGroupIds } },
        select: { id: true, workspaceId: true },
      });
      const groupWorkspaceMap = new Map(groups.map(g => [g.id, g.workspaceId]));

      // Restore states from Redis backup.
      // - Only groups with active state (onCall or isActiveForAssignment) are stored in backup.
      // - If current state is active (manual override), keep it and skip backup restoration.
      // - Otherwise, restore from backup if available.
      const restorePromises = userGroupIds.map((userGroupId) => {
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
            const groupWorkspaceId = groupWorkspaceMap.get(userGroupId);
            if (!groupWorkspaceId) {
              logger.warn(
                `⚠️ [ASSIGNMENT-STATE] No workspace found for user group ${userGroupId}; skipping state creation`
              );
              return Promise.resolve(null);
            }
            return this.prisma.userAssignmentState.create({
              data: {
                workspaceId: groupWorkspaceId,
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

      logger.info(
        `▶️ [ASSIGNMENT-STATE] User ${userId} set available for assignment in ${userGroupIds.length} group(s)`
      );
      return userGroupIds;
    } catch (error) {
      logger.error(`❌ [ASSIGNMENT-STATE] Error setting user available:`, error);
      throw error;
    }
  }
}

export const userAssignmentStateService = new UserAssignmentStateService();
