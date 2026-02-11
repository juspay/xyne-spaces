import { Router } from 'express';
import { applicationBackfillController } from '@/controllers/applicationBackfillController';

const router = Router();

/**
 * @route   POST /api/admin/applications/backfill
 * @desc    Backfill applications for a project
 * @access  Admin only
 * @body    { projectName?: string, channelId?: string }
 */
router.post(
  '/backfill',
  applicationBackfillController.backfillApplications.bind(applicationBackfillController)
);

/**
 * @route   GET /api/admin/applications
 * @desc    Get all applications for a project
 * @access  Admin only
 * @query   projectName (optional, defaults to "xyne-spaces")
 */
router.get(
  '/',
  applicationBackfillController.getApplications.bind(applicationBackfillController)
);

export default router;
