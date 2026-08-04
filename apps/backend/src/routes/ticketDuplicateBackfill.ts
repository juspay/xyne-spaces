import { Router } from 'express';
import { TicketDuplicateBackfillController } from '@/controllers/ticketDuplicateBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @desc Trigger ticket duplicate backfill
 */
router.post(
  '/',
  ...backfillAdminAuth,
  TicketDuplicateBackfillController.triggerBackfill
);

export default router;
