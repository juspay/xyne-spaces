import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { TicketEmailCountBackfillController } from '@/controllers/ticketEmailCountBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /migrate/api/admin/ticket-email-count-backfill
 * @desc One-time backfill of tickets.emailCount.
 *       Body: { batchSize?: number }  (default 25, batched over EMAIL channels)
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  adminAuth,
  TicketEmailCountBackfillController.triggerBackfill,
);

export default router;
