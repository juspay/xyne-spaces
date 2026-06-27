import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { InstalledAppCommandsBackfillController } from '@/controllers/installedAppCommandsBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const installedAppCommandsBackfillAdminAuth = authorize('XYNE-APPS', AccessType.ADMIN);

/**
 * @route POST /api/admin/installed-app-commands-backfill
 * @desc Backfill installed_app_commands — snapshot each app's current commands into each of its
 *       installs (the table is new, so existing installs have none). Idempotent.
 * @body { batchSize?: number, delayMs?: number, dryRun?: boolean }
 * @access XYNE-APPS Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  installedAppCommandsBackfillAdminAuth,
  InstalledAppCommandsBackfillController.triggerBackfill,
);

export default router;
