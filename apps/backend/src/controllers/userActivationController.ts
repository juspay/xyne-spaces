import { Request, Response } from 'express';
import { UserStatus } from '@prisma/client';
import { userActivationService } from '../services/userActivationService';
import { logger } from '../utils/logger';

export class UserActivationController {
  private static instance: UserActivationController;

  private constructor() {}

  public static getInstance(): UserActivationController {
    if (!UserActivationController.instance) {
      UserActivationController.instance = new UserActivationController();
    }
    return UserActivationController.instance;
  }

  /**
   * Bulk update user status (activate/deactivate)
   * POST /api/admin/user-activation
   *
   * Request Body:
   * {
   *   "userIds": ["user-id-1", "user-id-2"],
   *   "status": "INACTIVE" | "ACTIVE"
   * }
   */
  bulkUpdateUserStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { userIds, status } = req.body;

      // Validation
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'userIds must be a non-empty array'
        });
        return;
      }

      if (!status || !['ACTIVE', 'INACTIVE'].includes(status)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'status must be either "ACTIVE" or "INACTIVE"'
        });
        return;
      }

      // Scope the operation to the caller's workspace so a USERS-admin cannot
      // activate/deactivate users belonging to another workspace/tenant.
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized', message: 'No workspace in session' });
        return;
      }

      const result = await userActivationService.bulkUpdateUserStatus(
        userIds,
        status as UserStatus,
        workspaceId
      );

      const totalRequested = userIds.length;
      const successfulCount = result.successful.length;
      const failedCount = result.failed.length;

      // Determine response status based on results
      if (failedCount === 0) {
        // All succeeded
        res.status(200).json({
          success: true,
          message: `Successfully updated ${successfulCount} user(s) to ${status}`,
          ...result
        });
      } else if (successfulCount === 0) {
        // All failed
        res.status(422).json({
          success: false,
          message: `Failed to update all ${totalRequested} user(s)`,
          ...result
        });
      } else {
        // Partial success
        res.status(207).json({
          success: true,
          message: `Partially updated users: ${successfulCount} succeeded, ${failedCount} failed`,
          ...result
        });
      }
    } catch (error) {
      logger.error('Error in bulkUpdateUserStatus:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An error occurred while updating user statuses'
      });
    }
  };
}

export const userActivationController = UserActivationController.getInstance();
