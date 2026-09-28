import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { EmailReadFlagBackfillController } from '@/controllers/emailReadFlagBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * route POST /migrate/api/admin/email-read-flag-backfill
 * desc One-time backfill of email_reads.hasNewEmail for rows still NULL (true where
 *       lastReadEmailAt < tickets.lastEmailAt, else false). Runs in the background.
 *       Body: { batchSize?: number, delayMs?: number, dryRun?: boolean }
 *       (defaults 50 rows per batch, 1000ms between batches)
 * access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  adminAuth,
  EmailReadFlagBackfillController.triggerBackfill,
);

export default router;
