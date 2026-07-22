import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { TicketStageBackfillController } from '@/controllers/ticketStageBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/ticket-stage-backfill
 * @desc Move tickets in targetStage, or all stages when targetStage is omitted,
 *       to an explicit destinationStage or to a stage whose default status
 *       matches status for one desk channel.
 *       Body: {
 *         channelId: string,
 *         targetStage?: string,
 *         destinationStage?: string,
 *         status?: TicketStatusV2,
 *         boardId?: string,
 *         externalSourceType?: string,
 *         createdAfter?: string,
 *         dryRun?: boolean
 *       }
 *       Exactly one of destinationStage or status is required.
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  adminAuth,
  TicketStageBackfillController.triggerBackfill,
);

export default router;
