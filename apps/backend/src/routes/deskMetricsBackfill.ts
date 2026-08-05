import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { DeskMetricsBackfillController } from '@/controllers/deskMetricsBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

/**
 * @route POST /api/admin/desk-metrics-backfill
 * @desc Idempotent batched backfill: copies ticket.channelId onto
 *       ticket_activities for desk-channel tickets. Safe to re-run.
 *       Run once after deploying the desk-metrics migration.
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  authorize('TICKET-MIGRATION', AccessType.ADMIN),
  DeskMetricsBackfillController.triggerBackfill,
);

export default router;
