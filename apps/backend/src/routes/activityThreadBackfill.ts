import { Router } from 'express';
import { ActivityThreadBackfillController } from '@/controllers/activityThreadBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @route POST /api/admin/activity-thread-backfill
 * @desc Backfill isThreadActivity column on activities table
 * @body { batchSize?: number, delayMs?: number } - defaults: 50, 1000ms
 * @access Admin (TICKET-MIGRATION ADMIN)
 */
router.post(
  '/',
  ...backfillAdminAuth,
  ActivityThreadBackfillController.triggerBackfill
);

export default router;
