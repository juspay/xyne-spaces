import { Router, Request, Response, NextFunction } from 'express';
import { AdminBackfillController } from '@/controllers/vespaBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { AccessType } from '@prisma/client';

const router = Router();

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  // Always require authentication - no bypass for development/sandbox
  authMiddleware.authenticate(req, res, next);
};

// Resource-ACL gate: caller must hold WRITE (or ADMIN, which satisfies WRITE) on the VESPA resource.
const requireVespaAccess = authorize('VESPA', AccessType.WRITE);

/**
 * @desc Trigger Vespa backfill for all or specific schemas
 * @access Requires VESPA resource WRITE or ADMIN
*/
router.post(
  '/',
  requireAuth,
  requireVespaAccess,
  AdminBackfillController.triggerBackfill
);

/**
 * @route POST /api/admin/vespa-backfill/entities
 * @desc Trigger entity-generation backfill for a channel's threads
 * @query channelId (required), fromTimestamp, toTimestamp (ISO 8601, optional)
 */
router.post(
  '/entities',
  requireAuth,
  AdminBackfillController.triggerEntityBackfill
);

/**
 * @desc Get Vespa queue statistics
 * @access Requires VESPA resource WRITE or ADMIN
 */
router.get(
  '/stats',
  requireAuth,
  requireVespaAccess,
  AdminBackfillController.getQueueStats
);

/**
 * @desc Get queue jobs with pagination and state filter
 * @access Requires VESPA resource WRITE or ADMIN
 * @query page - Page number (default: 1)
 * @query limit - Jobs per page (default: 100)
 * @query state - Job state: waiting, active, delayed, completed, failed, or all (default: failed)
 */
router.get(
  '/jobs',
  requireAuth,
  requireVespaAccess,
  AdminBackfillController.getJobsWithState
);


/**
 * @route POST /api/admin/vespa-backfill/retry-failed
 * @desc Retry all failed jobs
 * @access Requires VESPA resource WRITE or ADMIN
 */
router.post(
  '/retryFailedJobs',
  requireAuth,
  requireVespaAccess,
  AdminBackfillController.retryFailedJobs
);


/**
 * @route DELETE /api/admin/vespa-backfill/jobs
 * @desc Clear jobs by state (waiting, active, delayed, completed, failed, or all)
 * @access Requires VESPA resource WRITE or ADMIN
 * @query state - Job state to clear: waiting, active, delayed, completed, failed, or all (required)
 * @warning Destructive operation - use with caution!
 */
router.delete(
  '/clearJobsByState',
  requireAuth,
  requireVespaAccess,
  AdminBackfillController.clearJobsByState
);




export default router;