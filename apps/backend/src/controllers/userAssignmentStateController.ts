import { Request, Response } from 'express';
import { userAssignmentStateService } from '@/services/userAssignmentStateService';
import { logger } from '@/utils/logger';

export class UserAssignmentStateController {
  /**
   * Toggle user availability for assignment
   * Toggle ON: Set user as unavailable (with unavailableUntil datetime)
   * Toggle OFF: Set user as available (restore from Redis backup)
   */
  async toggleAssignmentAvailability(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { isUnavailable, unavailableUntil, reassignExistingTickets = false } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (isUnavailable === true) {
        if (typeof reassignExistingTickets !== 'boolean') {
          res.status(400).json({ error: 'reassignExistingTickets must be a boolean.' });
          return;
        }

        // Toggle ON: Set user as unavailable
        if (!unavailableUntil) {
          res.status(400).json({ error: 'Please select a time.' });
          return;
        }

        const unavailableUntilTimestamp = parseInt(unavailableUntil, 10);

        if (isNaN(unavailableUntilTimestamp)) {
          res.status(400).json({ error: 'Please enter a valid value.' });
          return;
        }

        if (unavailableUntilTimestamp <= Date.now()) {
          res.status(400).json({ error: 'Please select a future time.' });
          return;
        }

        const userGroupIds = await userAssignmentStateService.setUnavailableForAssignment(
          userId,
          unavailableUntilTimestamp,
          reassignExistingTickets
        );

        res.json({
          success: true,
          message: 'User set as unavailable for assignment',
          unavailableUntil: unavailableUntilTimestamp,
          reassignExistingTickets,
          userGroupIds,
          groupCount: userGroupIds.length,
        });

        logger.info(
          `👤 [ASSIGNMENT-STATE-API] User ${userId} set unavailable for assignment until ${new Date(unavailableUntilTimestamp).toISOString()}${reassignExistingTickets ? ' with existing-ticket reassignment requested' : ''}`
        );
      } else {
        // Toggle OFF: Set user as available (restore from backup)
        const userGroupIds = await userAssignmentStateService.setAvailableForAssignment(userId);

        res.json({
          success: true,
          message: 'User set as available for assignment',
          userGroupIds,
          groupCount: userGroupIds.length,
        });

        logger.info(
          `👤 [ASSIGNMENT-STATE-API] User ${userId} set available for assignment in ${userGroupIds.length} group(s)`
        );
      }
    } catch (error) {
      logger.error('❌ [ASSIGNMENT-STATE-API] Error toggling assignment availability:', error);
      res.status(500).json({ error: 'Failed to toggle assignment availability' });
    }
  }

  /**
   * Hand off a member's open tickets in one group after an admin deactivates them
   * from the group's assignment configuration screen.
   */
  async reassignMemberTickets(req: Request, res: Response): Promise<void> {
    try {
      const workspaceId = req.user?.workspaceId;
      const { userId, userGroupId } = req.body;

      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (typeof userId !== 'string' || !userId) {
        res.status(400).json({ error: 'userId is required.' });
        return;
      }

      if (typeof userGroupId !== 'string' || !userGroupId) {
        res.status(400).json({ error: 'userGroupId is required.' });
        return;
      }

      const result = await userAssignmentStateService.reassignMemberTicketsInGroup(
        userId,
        userGroupId,
        workspaceId
      );

      if (!result.scheduled) {
        const status = result.reason === 'REASSIGNMENT_NOT_ALLOWED' ? 403 : 404;
        res.status(status).json({ success: false, reason: result.reason });

        logger.warn(
          `⚠️ [ASSIGNMENT-STATE-API] Reassignment for user ${userId} in group ${userGroupId} not scheduled: ${result.reason}`
        );
        return;
      }

      res.json({ success: true, userId, userGroupId });

      logger.info(
        `👤 [ASSIGNMENT-STATE-API] User ${req.user?.id} queued ticket handoff for member ${userId} in group ${userGroupId}`
      );
    } catch (error) {
      logger.error('❌ [ASSIGNMENT-STATE-API] Error reassigning member tickets:', error);
      res.status(500).json({ error: 'Failed to reassign member tickets' });
    }
  }
}

export const userAssignmentStateController = new UserAssignmentStateController();
