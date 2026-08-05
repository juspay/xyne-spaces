import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { TicketActivitySystemActorBackfillController } from '@/controllers/ticketActivitySystemActorBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

/**
 * @route POST /api/admin/ticket-activity-system-actor-backfill
 * @desc Backfill ticket_activities.updatedBy from the legacy 'system' literal
 *       to the real automations bot User id, per workspace.
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  authorize('TICKET-MIGRATION', AccessType.ADMIN),
  TicketActivitySystemActorBackfillController.triggerBackfill,
);

export default router;
