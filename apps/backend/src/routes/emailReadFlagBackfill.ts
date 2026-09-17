import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { EmailReadFlagBackfillController } from '@/controllers/emailReadFlagBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route GET /api/admin/email-read-flag-backfill/status
 * @desc Read-only counts: `pending` (email_reads rows whose hasNewEmail is still
 *       NULL — the work outstanding, 0 when done), `hasNewEmail` and `noNewEmail`.
 * @access TICKET-MIGRATION Admin only
 */
router.get(
  '/status',
  authMiddleware.authenticate,
  adminAuth,
  EmailReadFlagBackfillController.status,
);

/**
 * @route POST /api/admin/email-read-flag-backfill/run
 * @desc Compute email_reads.hasNewEmail for rows still NULL: true where
 *       lastReadEmailAt < tickets.lastEmailAt, false otherwise. In batches, pausing
 *       between them.
 *       Body: { batchSize?: 500, delayMs?: 1000, maxBatches?: 50, dryRun?: false,
 *               cursor?: string }
 *       Returns per-batch { batch, scanned, setTrue, setFalse }, the totals, `done` and
 *       `nextCursor`. Pass `nextCursor` back as `cursor` to continue where the
 *       previous request stopped. Idempotent — safe to re-run; run it after the
 *       new backend is live.
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/run',
  authMiddleware.authenticate,
  adminAuth,
  EmailReadFlagBackfillController.run,
);

export default router;
