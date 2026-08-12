import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { BoardConfigCopyController } from '@/controllers/boardConfigCopyController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/board-config-copy/prepare
 * @desc Validate a source/target board pair and return the stage remap plan; when that plan
 *       is fully resolved and `dryRun` is false, also perform the server-only work (pre-copy
 *       snapshot, custom-fields form clone) and return `prepared` — the arguments the
 *       dashboard passes to the ordinary Zero mutators. Writes no board configuration itself,
 *       and writes nothing at all on a call that can't yet commit.
 * @access TICKET-MIGRATION Admin only
 */
router.post('/prepare', authMiddleware.authenticate, adminAuth, BoardConfigCopyController.prepare);

/**
 * @route POST /api/admin/board-config-copy/start-ticket-migration
 * @desc Enqueue the per-ticket migration a prepared copy left pending, after the client has
 *       committed the configuration. Returns 202 with jobId (=== targetBoardId).
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/start-ticket-migration',
  authMiddleware.authenticate,
  adminAuth,
  BoardConfigCopyController.startTicketMigration,
);

export default router;
