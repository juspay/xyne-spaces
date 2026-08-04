import { Router } from 'express';
import { WorkspaceIdBackfillController } from '@/controllers/workspaceIdBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @route POST /migrate/api/admin/workspace-id-backfill
 * @desc Backfill workspaceId across records
 * @access Admin (TICKET-MIGRATION ADMIN)
 */
router.post('/', ...backfillAdminAuth, WorkspaceIdBackfillController.triggerBackfill);

export default router;
