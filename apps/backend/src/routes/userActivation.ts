import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { userActivationController } from '@/controllers/userActivationController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

// Middleware to check for USERS admin access (same as user-management)
const usersAdminAuth = authorize('USERS', AccessType.ADMIN);

/**
 * @route POST /api/user-activation
 * @desc Bulk update user status (activate/deactivate multiple users)
 * @access USERS Admin only
 *
 * Request Body:
 * {
 *   "userIds": ["user-id-1", "user-id-2", ...],
 *   "status": "ACTIVE" | "INACTIVE"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Successfully updated 2 user(s) to INACTIVE",
 *   "successful": ["user-id-1", "user-id-2"],
 *   "failed": []
 * }
 */
router.post(
  '/',
  authMiddleware.authenticate,
  usersAdminAuth,
  userActivationController.bulkUpdateUserStatus
);

export default router;
