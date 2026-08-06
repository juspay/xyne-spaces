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
 * @route POST /api/admin/board-config-copy/execute
 * @desc Copy custom fields/settings, roles, and/or stages from sourceBoardId onto
 *       targetBoardId. When categories.stages is set and the operation isn't a dry run,
 *       enqueues a background job (jobId === targetBoardId) and returns 202 immediately.
 * @access TICKET-MIGRATION Admin only
 */
router.post('/execute', authMiddleware.authenticate, adminAuth, BoardConfigCopyController.execute);

/**
 * @route GET /api/admin/board-config-copy/status/:jobId
 * @desc Poll the status/progress/result of a previously enqueued copy job.
 * @access TICKET-MIGRATION Admin only
 */
router.get('/status/:jobId', authMiddleware.authenticate, adminAuth, BoardConfigCopyController.status);

export default router;
