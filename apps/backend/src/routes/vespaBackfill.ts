import { Router } from 'express';
import { AdminBackfillController } from '@/controllers/vespaBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @desc Trigger Vespa backfill for all or specific schemas
 * @access Admin (TICKET-MIGRATION ADMIN)
*/
router.post(
  '/',
  ...backfillAdminAuth,
  AdminBackfillController.triggerBackfill
);

/**
 * @route POST /api/admin/vespa-backfill/entities
 * @desc Trigger entity-generation backfill for a channel's threads
 * @query channelId (required), fromTimestamp, toTimestamp (ISO 8601, optional)
 */
router.post(
  '/entities',
  ...backfillAdminAuth,
  AdminBackfillController.triggerEntityBackfill
);

/**
 * @desc Get Vespa queue statistics
 * @access Admin (TICKET-MIGRATION ADMIN)
 */
router.get(
  '/stats',
  ...backfillAdminAuth,
  AdminBackfillController.getQueueStats
);

/**
 * @desc Get queue jobs with pagination and state filter
 * @access Admin (TICKET-MIGRATION ADMIN)
 * @query page - Page number (default: 1)
 * @query limit - Jobs per page (default: 100)
 * @query state - Job state: waiting, active, delayed, completed, failed, or all (default: failed)
 */
router.get(
  '/jobs',
  ...backfillAdminAuth,
  AdminBackfillController.getJobsWithState
);


/**
 * @route POST /api/admin/vespa-backfill/retry-failed
 * @desc Retry all failed jobs
 * @access Admin (TICKET-MIGRATION ADMIN)
 */
router.post(
  '/retryFailedJobs',
  ...backfillAdminAuth,
  AdminBackfillController.retryFailedJobs
);


/**
 * @route DELETE /api/admin/vespa-backfill/jobs
 * @desc Clear jobs by state (waiting, active, delayed, completed, failed, or all)
 * @access Admin (TICKET-MIGRATION ADMIN)
 * @query state - Job state to clear: waiting, active, delayed, completed, failed, or all (required)
 * @warning Destructive operation - use with caution!
 */
router.delete(
  '/clearJobsByState',
  ...backfillAdminAuth,
  AdminBackfillController.clearJobsByState
);




export default router;