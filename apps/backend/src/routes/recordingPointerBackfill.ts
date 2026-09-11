import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { RecordingSummaryPointerBackfillController } from '@/controllers/recordingSummaryPointerBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route GET /api/admin/recording-pointer-backfill/status
 * @desc Read-only counts: `linkable` (recordings with a summary canvas and no
 *       pointer — the real work outstanding), `pointerAbsent` (which also counts
 *       recordings that have no canvas to link), and `summaryCanvases`.
 * @access TICKET-MIGRATION Admin only
 */
router.get(
  '/status',
  authMiddleware.authenticate,
  adminAuth,
  RecordingSummaryPointerBackfillController.status,
);

/**
 * @route POST /api/admin/recording-pointer-backfill/run
 * @desc Link orphaned detailed-summary canvases in batches, pausing between them.
 *       Body: { batchSize?: 50, delayMs?: 5000, maxBatches?: 20, dryRun?: false,
 *               cursor?: string }
 *       Returns per-batch { batch, updated, remaining }, the totals, `done`,
 *       `nextCursor` and the linked externalIds for rollback. Pass `nextCursor`
 *       back as `cursor` to continue where the previous request stopped.
 *       Idempotent — safe to re-run.
 *
 *       RUN WITH NO ACTIVE RECORDINGS: each row is a read-merge-write of the
 *       whole metadata column (Prisma cannot do a partial JSON update), so a
 *       pipeline writing the same row concurrently could have its key dropped.
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/run',
  authMiddleware.authenticate,
  adminAuth,
  RecordingSummaryPointerBackfillController.run,
);

export default router;
