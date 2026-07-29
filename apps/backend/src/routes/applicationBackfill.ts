import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { authorize } from '@/middleware/authorize';
import { applicationBackfillController } from '@/controllers/applicationBackfillController';

const router = Router();

const applicationBackfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route   POST /api/admin/applications/backfill
 * @desc    Backfill applications for a project
 * @access  TICKET-MIGRATION Admin only
 * @body    { projectName?: string, channelId?: string }
 */
router.post(
  '/backfill',
  applicationBackfillAdminAuth,
  applicationBackfillController.backfillApplications.bind(applicationBackfillController)
);

/**
 * @route   GET /api/admin/applications
 * @desc    Get all applications for a project
 * @access  TICKET-MIGRATION Admin only
 * @query   projectName (optional, defaults to "xyne-spaces")
 */
router.get(
  '/',
  applicationBackfillAdminAuth,
  applicationBackfillController.getApplications.bind(applicationBackfillController)
);

export default router;
