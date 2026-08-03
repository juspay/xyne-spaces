import { Router } from 'express';
import { AppSigningSecretBackfillController } from '@/controllers/appSigningSecretBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @route POST /api/admin/app-signing-secret-backfill
 * @desc Backfill apps.signingSecret — copy each app's existing per-install secret up to the app,
 *       or generate one for apps that have none. Idempotent.
 * @body { batchSize?: number, delayMs?: number, dryRun?: boolean }
 * @access Admin (TICKET-MIGRATION ADMIN)
 */
router.post(
  '/',
  ...backfillAdminAuth,
  AppSigningSecretBackfillController.triggerBackfill,
);

export default router;
