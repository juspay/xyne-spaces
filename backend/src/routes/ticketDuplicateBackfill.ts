import { Router } from 'express';
import { TicketDuplicateBackfillController } from '@/controllers/ticketDuplicateBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { AccessType } from '@prisma/client';

const router = Router();

/**
 * @desc Trigger ticket duplicate backfill
 */
router.post(
  '/',
  authMiddleware.authenticate,
  authorize('TICKETS', AccessType.ADMIN),
  TicketDuplicateBackfillController.triggerBackfill
);

export default router;
