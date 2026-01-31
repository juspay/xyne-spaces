import { Router, Request, Response, NextFunction } from 'express';
import { AdminBackfillController } from '@/controllers/vespaBackfillController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  // Always require authentication - no bypass for development/sandbox
  authMiddleware.authenticate(req, res, next);
};

/**
 * @desc Trigger Vespa backfill for all or specific schemas
*/
router.post(
  '/',
  requireAuth,
  AdminBackfillController.triggerBackfill
);

/**
 * @desc Get Vespa queue statistics
 */
router.get(
  '/stats',
  requireAuth,
  AdminBackfillController.getQueueStats
);

/**
 * @desc Get queue jobs with pagination and state filter
 * @access Any authenticated user
 * @query page - Page number (default: 1)
 * @query limit - Jobs per page (default: 100)
 * @query state - Job state: waiting, active, delayed, completed, failed, or all (default: failed)
 */
router.get(
  '/jobs',
  requireAuth,
  AdminBackfillController.getJobsWithState
);


/**
 * @route POST /api/admin/vespa-backfill/retry-failed
 * @desc Retry all failed jobs
 * @access Any authenticated user
 */
router.post(
  '/retryFailedJobs',
  requireAuth,
  AdminBackfillController.retryFailedJobs
);


/**
 * @route DELETE /api/admin/vespa-backfill/jobs
 * @desc Clear jobs by state (waiting, active, delayed, completed, failed, or all)
 * @access Any authenticated user
 * @query state - Job state to clear: waiting, active, delayed, completed, failed, or all (required)
 * @warning Destructive operation - use with caution!
 */
router.delete(
  '/clearJobsByState',
  requireAuth,
  AdminBackfillController.clearJobsByState
);




export default router;