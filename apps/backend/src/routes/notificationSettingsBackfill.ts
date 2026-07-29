import { Router } from 'express';
import { NotificationSettingsBackfillController } from '@/controllers/notificationSettingsBackfillController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * @route POST /api/admin/notification-settings-backfill
 * @desc Backfill deprecated THREADS_ONLY notification levels to NULL
 * @access Authenticated users
 */
router.post(
  '/',
  authMiddleware.authenticate,
  NotificationSettingsBackfillController.triggerBackfill
);

export default router;
