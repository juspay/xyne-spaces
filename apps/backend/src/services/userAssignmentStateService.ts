import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { assignmentReactivationQueue } from '@/queues/assignmentReactivationQueue';
import { ticketReassignmentQueue } from '@/queues/ticketReassignmentQueue';
import { redisService } from './redisService';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { ActivityClassification } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
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
      let reassignGroups: { id: string }[] = [];
      if (reassignExistingTickets) {
        const candidateGroups = await this.prisma.userGroup.findMany({
          where: { id: { in: userGroupIds } },
          select: { id: true, reassignOnUnavailable: true },
        });
        reassignGroups = candidateGroups.filter(
          (group) => (group.reassignOnUnavailable ?? false) === true
        );
      }

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

      // Notify subscribers (user_group_mappings.isNotified) of all user groups
      await this.notifySubscribersOfPause(userId, userGroupIds, unavailableUntil);

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
   * Hand off a member's open tickets in one group after an admin deactivates them.
   * Called from assignmentConfig.batchUpdate's post-commit hook, so every lookup here
   * reads committed rows. Same policy as the member pause flow: the group must allow it,
   * and the member must already be inactive for assignment.
   * @param userId - Member being deactivated
   * @param userGroupId - Group whose open tickets should be handed off
   * @param workspaceId - Caller's workspace, used to scope the group lookup
   */
  async reassignMemberTicketsInGroup(
    userId: string,
    userGroupId: string,
    workspaceId: string
  ): Promise<{ scheduled: boolean; reason?: string }> {
    try {
      const group = await this.prisma.userGroup.findFirst({
        where: { id: userGroupId, workspaceId },
        select: { id: true, reassignOnUnavailable: true },
      });

      if (!group) {
        return { scheduled: false, reason: 'GROUP_NOT_FOUND' };
      }

      if ((group.reassignOnUnavailable ?? false) !== true) {
        return { scheduled: false, reason: 'REASSIGNMENT_NOT_ALLOWED' };
      }

      const membership = await this.prisma.userGroupMapping.findFirst({
        where: { userId, userGroupId },
        select: { id: true },
      });

      if (!membership) {
        return { scheduled: false, reason: 'NOT_A_GROUP_MEMBER' };
      }

      // Only hand off for a member who has actually stopped taking new work, so the
      // method cannot redistribute an active member's tickets. A missing row counts as
      // inactive - the assignment engine treats it that way.
      const state = await this.prisma.userAssignmentState.findFirst({
        where: { userId, userGroupId },
        select: { isActiveForAssignment: true },
      });

      if (state?.isActiveForAssignment === true) {
        return { scheduled: false, reason: 'MEMBER_STILL_ACTIVE' };
      }

      await ticketReassignmentQueue.scheduleReassignment(userId, userGroupId);

      logger.info(
        `⏳ [ASSIGNMENT-STATE] Admin-initiated reassignment queued for user ${userId} in group ${userGroupId}`
      );

      return { scheduled: true };
    } catch (error) {
      logger.error(`❌ [ASSIGNMENT-STATE] Error scheduling admin reassignment:`, error);
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

      // Notify subscribers (user_group_mappings.isNotified) that user is available again
      await this.notifySubscribersOfResume(userId, userGroupIds);

      logger.info(
        `▶️ [ASSIGNMENT-STATE] User ${userId} set available for assignment in ${userGroupIds.length} group(s)`
      );
      return userGroupIds;
    } catch (error) {
      logger.error(`❌ [ASSIGNMENT-STATE] Error setting user available:`, error);
      throw error;
    }
  }

  /**
   * Get all subscribers for given user groups — members with
   * user_group_mappings.isNotified = true. Replaces the pre-role-framework
   * `getManagersForUserGroups` (responsibility === MANAGER), which was removed
   * when responsibility moved to the roles table.
   * @param userGroupIds - Array of user group IDs
   * @returns Array of unique subscriber user IDs
   */
  private async getSubscribersForUserGroups(userGroupIds: string[]): Promise<string[]> {
    if (userGroupIds.length === 0) return [];

    try {
      const subscriberMappings = await this.prisma.userGroupMapping.findMany({
        where: {
          userGroupId: { in: userGroupIds },
          isNotified: true,
        },
        select: { userId: true },
      });

      return [...new Set(subscriberMappings.map((m) => m.userId))];
    } catch (error) {
      logger.error(`❌ [ASSIGNMENT-STATE] Error getting subscribers for user groups:`, error);
      return [];
    }
  }

  /**
   * Notify subscribers when a user pauses from ticket assignment: an
   * Activities-tab entry (matching AssignmentPauseActivity's expected shape)
   * plus a desktop/mobile push via notificationService.
   * @param userId - User ID who paused
   * @param userGroupIds - User groups the user belongs to
   * @param unavailableUntil - Timestamp when user will be available again
   */
  private async notifySubscribersOfPause(
    userId: string,
    userGroupIds: string[],
    unavailableUntil: number
  ): Promise<void> {
    try {
      const subscriberIds = await this.getSubscribersForUserGroups(userGroupIds);

      if (subscriberIds.length === 0) {
        logger.debug(`ℹ️ [ASSIGNMENT-STATE] No subscribers found for user groups: ${userGroupIds.join(', ')}`);
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, workspaceId: true },
      });

      const userName = user?.name || user?.email || 'A team member';
      const availableAt = new Date(unavailableUntil).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

      const recipientIds = subscriberIds.filter((subscriberId) => subscriberId !== userId); // Don't notify the user themselves

      const activities = recipientIds.map((subscriberId) => ({
        id: uuidv4(),
        userId: subscriberId,
        actorAction: 'paused_from_assignment',
        actionSource: 'assignment',
        actionSourceId: userId,
        actorId: userId,
        classification: ActivityClassification.FYI,
      }));

      if (activities.length > 0) {
        await activityService.createActivities(activities);
        logger.info(
          `📢 [ASSIGNMENT-STATE] Notified ${activities.length} subscriber(s) that ${userName} paused from ticket assignment until ${availableAt}`
        );
      }

      if (user?.workspaceId) {
        await notificationService.sendAssignmentPauseNotification(
          userId,
          userName,
          user.workspaceId,
          recipientIds,
          unavailableUntil,
        );
      }
    } catch (error) {
      // Don't throw - notification failure shouldn't break the pause action
      logger.error(`❌ [ASSIGNMENT-STATE] Error notifying subscribers of pause:`, error);
    }
  }

  /**
   * Notify subscribers when a user resumes from ticket assignment: an
   * Activities-tab entry plus a desktop/mobile push via notificationService.
   * @param userId - User ID who resumed
   * @param userGroupIds - User group IDs the user belongs to
   */
  private async notifySubscribersOfResume(
    userId: string,
    userGroupIds: string[]
  ): Promise<void> {
    try {
      const subscriberIds = await this.getSubscribersForUserGroups(userGroupIds);

      if (subscriberIds.length === 0) {
        logger.debug(`ℹ️ [ASSIGNMENT-STATE] No subscribers found for user groups: ${userGroupIds.join(', ')}`);
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, workspaceId: true },
      });

      const userName = user?.name || user?.email || 'A team member';
      const recipientIds = subscriberIds.filter((subscriberId) => subscriberId !== userId); // Don't notify the user themselves

      const activities = recipientIds.map((subscriberId) => ({
        id: uuidv4(),
        userId: subscriberId,
        actorAction: 'resumed_from_assignment',
        actionSource: 'assignment',
        actionSourceId: userId,
        actorId: userId,
        classification: ActivityClassification.FYI,
      }));

      if (activities.length > 0) {
        await activityService.createActivities(activities);
        logger.info(
          `📢 [ASSIGNMENT-STATE] Notified ${activities.length} subscriber(s) that ${userName} resumed from ticket assignment`
        );
      }

      if (user?.workspaceId) {
        await notificationService.sendAssignmentResumeNotification(
          userId,
          userName,
          user.workspaceId,
          recipientIds,
        );
      }
    } catch (error) {
      // Don't throw - notification failure shouldn't break the resume action
      logger.error(`❌ [ASSIGNMENT-STATE] Error notifying subscribers of resume:`, error);
    }
  }
}

export const userAssignmentStateService = new UserAssignmentStateService();
