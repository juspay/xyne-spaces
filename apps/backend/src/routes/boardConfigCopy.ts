import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { BoardConfigCopyController } from '@/controllers/boardConfigCopyController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/board-config-copy/plan
 * @desc Validate a source/target board pair and preview the stage remap plan (no writes).
 * @access TICKET-MIGRATION Admin only
 */
router.post('/plan', authMiddleware.authenticate, adminAuth, BoardConfigCopyController.plan);

/**
 * @route POST /api/admin/board-config-copy/prepare
 * @desc Perform the server-only half of a copy (validation, pre-copy snapshot, custom-fields
 *       form clone) and return the arguments the dashboard passes to the ordinary Zero
 *       mutators to commit the configuration. Writes no board configuration itself.
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
