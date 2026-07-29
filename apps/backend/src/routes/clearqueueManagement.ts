import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { ClearqueueManagementController } from '@/controllers/clearqueueManagementController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

// Middleware to check for CLEAR-QUEUE admin access
const clearQueueAdminAuth = authorize('CLEAR-QUEUE', AccessType.ADMIN);

/**
 * @route GET /api/admin/queue-management/stats/:queueName
 * @desc Get statistics for a specific queue
 * @access QUEUE-MANAGEMENT Admin only
 */
router.get(
  '/stats/:queueName',
  authMiddleware.authenticate,
  clearQueueAdminAuth,
  ClearqueueManagementController.getQueueStats
);

/**
 * @route POST /api/admin/queue-management/clear/:queueName
 * @desc Clear a specific queue (remove repeatable jobs and optionally clean all job states)
 * @access QUEUE-MANAGEMENT Admin only
 *
 * Request Body:
 * {
 *   "repeatableOnly": false  // Optional: set to true to only remove repeatable jobs
 * }
 */
router.post(
  '/clear/:queueName',
  authMiddleware.authenticate,
  clearQueueAdminAuth,
  ClearqueueManagementController.clearQueue
);

/**
 * @route GET /api/admin/queue-management/all-stats
 * @desc Get statistics for all managed queues
 * @access QUEUE-MANAGEMENT Admin only
 */
router.get(
  '/all-stats',
  authMiddleware.authenticate,
  clearQueueAdminAuth,
  ClearqueueManagementController.getAllStats
);

export default router;
