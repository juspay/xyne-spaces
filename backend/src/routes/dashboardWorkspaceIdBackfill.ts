import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { DashboardWorkspaceIdBackfillController } from '@/controllers/dashboardWorkspaceIdBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();
const adminAuth = authorize('DASHBOARDS', AccessType.ADMIN);

/**
 * @route POST /api/admin/dashboard-workspace-id-backfill
 * @desc Backfill workspaceId on dashboards from their creator's User.workspaceId
 * @body { batchSize?: number, delayMs?: number, dryRun?: boolean } - defaults: 100, 1000ms, false
 * @note Clashing dashboards (same (workspaceId, name) as another row) are auto-renamed
 *       to "{name} ({creator.email})", falling back to "{name} ({email}) [{id-suffix}]"
 *       if that also collides.
 * @access Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  adminAuth,
  DashboardWorkspaceIdBackfillController.triggerBackfill,
);

export default router;
