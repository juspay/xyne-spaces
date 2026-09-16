import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { EmailReadFlagBackfillController } from '@/controllers/emailReadFlagBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route GET /api/admin/email-read-flag-backfill/status
 * @desc Read-only counts: `pending` (unflagged email_reads rows whose ticket has
 *       newer email — the real work outstanding), `unflagged` and `flagged`.
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
 * @desc Set email_reads.hasNewEmail where lastReadEmailAt < tickets.lastEmailAt,
 *       in batches, pausing between them.
 *       Body: { batchSize?: 500, delayMs?: 1000, maxBatches?: 50, dryRun?: false,
 *               cursor?: string }
 *       Returns per-batch { batch, scanned, updated }, the totals, `done` and
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
