import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { AppSigningSecretBackfillController } from '@/controllers/appSigningSecretBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const appSigningSecretBackfillAdminAuth = authorize('XYNE-APPS', AccessType.ADMIN);

/**
 * @route POST /api/admin/app-signing-secret-backfill
 * @desc Backfill apps.signingSecret — copy each app's existing per-install secret up to the app,
 *       or generate one for apps that have none. Idempotent.
 * @body { batchSize?: number, delayMs?: number, dryRun?: boolean }
 * @access XYNE-APPS Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  appSigningSecretBackfillAdminAuth,
  AppSigningSecretBackfillController.triggerBackfill,
);

export default router;
