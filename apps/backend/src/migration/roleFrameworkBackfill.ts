import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { RoleFrameworkBackfillController } from '@/controllers/roleFrameworkBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const roleFrameworkBackfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route GET /api/admin/role-framework-backfill/stats
 * @desc Get role-framework backfill statistics
 * @access TICKET-MIGRATION Admin only
 */
router.get(
  '/stats',
  authMiddleware.authenticate,
  roleFrameworkBackfillAdminAuth,
  RoleFrameworkBackfillController.getBackfillStats,
);

/**
 * @route POST /api/admin/role-framework-backfill
 * @desc Run a role-framework backfill. Mode is selected via body.mode.
 * @access TICKET-MIGRATION Admin only
 *
 * Request body:
 * - mode: one of seedDefaultRoles, userGroupMappingsRoleId, boardMetadata,
 *   stageApproversApproverType, userRoleMappings, ticketAssignmentsRoleId
 * - batchSize: number (default 50)
 * - delayMs: number (default 100)
 * - dryRun: boolean (default false)
 */
router.post(
  '/',
  authMiddleware.authenticate,
  roleFrameworkBackfillAdminAuth,
  RoleFrameworkBackfillController.triggerBackfill,
);

export default router;
