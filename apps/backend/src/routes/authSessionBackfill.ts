import { Router } from 'express';
import { AuthSessionBackfillController } from '@/controllers/authSessionBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @route GET /api/admin/auth-session-backfill/status
 * @desc Read-only counts: `legacyActive` live legacy rows, `mapped` (a grant points at
 *       them), `remaining` (the work outstanding), plus `authSessions` / `grants` totals.
 * @access TICKET-MIGRATION Admin only
 */
router.get('/status', ...backfillAdminAuth, AuthSessionBackfillController.status);

/**
 * @route POST /api/admin/auth-session-backfill/run
 * @desc Mint auth_sessions + session_workspace_grants for unmapped live legacy rows, in
 *       batches, pausing between them.
 *       Body: { batchSize?: 200 (≤500), delayMs?: 1000, maxBatches?: 20, dryRun?: false,
 *               cursor?: string, allOrgs?: false }
 *       Returns per-batch counts, the totals, `done` and `nextCursor`; pass `nextCursor`
 *       back as `cursor` to continue. Idempotent — safe to re-run.
 * @access TICKET-MIGRATION Admin only
 */
router.post('/run', ...backfillAdminAuth, AuthSessionBackfillController.run);

export default router;
