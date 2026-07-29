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
      const { isUnavailable, unavailableUntil } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (isUnavailable === true) {
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
          unavailableUntilTimestamp
        );

        res.json({
          success: true,
          message: 'User set as unavailable for assignment',
          unavailableUntil: unavailableUntilTimestamp,
          userGroupIds,
          groupCount: userGroupIds.length,
        });

        logger.info(`👤 [ASSIGNMENT-STATE-API] User ${userId} set unavailable for assignment until ${new Date(unavailableUntilTimestamp).toISOString()}`);
      } else {
        // Toggle OFF: Set user as available (restore from backup)
        const userGroupIds = await userAssignmentStateService.setAvailableForAssignment(userId);

        res.json({
          success: true,
          message: 'User set as available for assignment',
          userGroupIds,
          groupCount: userGroupIds.length,
        });

        logger.info(`👤 [ASSIGNMENT-STATE-API] User ${userId} set available for assignment in ${userGroupIds.length} group(s)`);
      }
    } catch (error) {
      logger.error('❌ [ASSIGNMENT-STATE-API] Error toggling assignment availability:', error);
      res.status(500).json({ error: 'Failed to toggle assignment availability' });
    }
  }
}

export const userAssignmentStateController = new UserAssignmentStateController();
