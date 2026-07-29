import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { QueriesEntityTypeBackfillController } from '@/controllers/queriesEntityTypeBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const queriesEntityTypeBackfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route GET /api/admin/queries-entity-type-backfill/stats
 * @desc Get backfill statistics
 * @access TICKET-MIGRATION Admin only
 */
router.get(
  '/stats',
  authMiddleware.authenticate,
  queriesEntityTypeBackfillAdminAuth,
  QueriesEntityTypeBackfillController.getBackfillStats
);

/**
 * @route POST /api/admin/queries-entity-type-backfill
 * @desc Backfill targetEntity from entityType in queries table
 * @access TICKET-MIGRATION Admin only
 *
 * Request body options:
 * - batchSize: Number of records to process per batch (default: 100)
 * - delayMs: Delay between batches in milliseconds (default: 0)
 * - dryRun: If true, only counts without updating (default: false)
 * - clearEntityType: If true, also sets entityType to null after copying (default: false)
 */
router.post(
  '/',
  authMiddleware.authenticate,
  queriesEntityTypeBackfillAdminAuth,
  QueriesEntityTypeBackfillController.triggerBackfill
);

export default router;
