import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { AutomationSeriesIdBackfillController } from '@/controllers/automationSeriesIdBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const migrationAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /migrate/api/admin/automation-series-id-backfill
 * @desc Collapse automationSeriesId to the lineage root for every automation
 * @access TICKET-MIGRATION Admin only
 * @body { batchSize?: number, delayMs?: number, dryRun?: boolean }
 */
router.post(
  '/',
  authMiddleware.authenticate,
  migrationAdminAuth,
  AutomationSeriesIdBackfillController.triggerBackfill,
);

export default router;
