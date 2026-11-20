import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { FormEntityValueBackfillController } from '@/controllers/formEntityValueBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route GET /api/admin/form-entity-value-backfill/status
 * @desc Read-only: `pending` = custom-field values still stored only in actualFieldValue.
 * @access TICKET-MIGRATION Admin only
 */
router.get('/status', authMiddleware.authenticate, adminAuth, FormEntityValueBackfillController.status);

/**
 * @route POST /api/admin/form-entity-value-backfill/run
 * @desc Copy old custom-field values into the typed columns, in batches.
 *       Body: { batchSize?: 200, delayMs?: 1000, maxBatches?: 20, dryRun?: false, cursor?: string }
 *       Returns per-batch counts, totals, `unconvertibleFields`, `done` and `nextCursor`.
 *       Pass `nextCursor` back as `cursor` to continue; repeat until `done` is true.
 *       Idempotent — safe to re-run; start with dryRun: true.
 * @access TICKET-MIGRATION Admin only
 */
router.post('/run', authMiddleware.authenticate, adminAuth, FormEntityValueBackfillController.run);

export default router;
