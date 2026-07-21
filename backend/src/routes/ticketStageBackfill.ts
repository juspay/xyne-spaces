import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { TicketStageBackfillController } from '@/controllers/ticketStageBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/ticket-stage-backfill
 * @desc Move tickets in targetStage to destinationStage for one desk channel.
 *       Body: {
 *         channelId: string,
 *         targetStage: string,
 *         destinationStage: string,
 *         dryRun?: boolean
 *       }
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  adminAuth,
  TicketStageBackfillController.triggerBackfill,
);

export default router;
