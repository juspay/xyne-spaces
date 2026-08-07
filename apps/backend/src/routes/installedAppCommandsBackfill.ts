import { Router } from 'express';
import { InstalledAppCommandsBackfillController } from '@/controllers/installedAppCommandsBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @route POST /api/admin/installed-app-commands-backfill
 * @desc Backfill installed_app_commands — snapshot each app's current commands into each of its
 *       installs (the table is new, so existing installs have none). Idempotent.
 * @body { batchSize?: number, delayMs?: number, dryRun?: boolean }
 * @access Admin (TICKET-MIGRATION ADMIN)
 */
router.post(
  '/',
  ...backfillAdminAuth,
  InstalledAppCommandsBackfillController.triggerBackfill,
);

export default router;
