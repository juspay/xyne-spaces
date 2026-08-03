import { Router } from 'express';
import { NotificationSettingsBackfillController } from '@/controllers/notificationSettingsBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @route POST /api/admin/notification-settings-backfill
 * @desc Backfill deprecated THREADS_ONLY notification levels to NULL
 * @access Admin (TICKET-MIGRATION ADMIN)
 */
router.post(
  '/',
  ...backfillAdminAuth,
  NotificationSettingsBackfillController.triggerBackfill
);

export default router;
