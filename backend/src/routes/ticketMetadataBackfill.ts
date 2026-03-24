import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { TicketMetadataBackfillController } from '@/controllers/ticketMetadataBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const ticketMetadataBackfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/ticket-metadata-backfill
 * @desc Backfill ticket_md in conversations
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  ticketMetadataBackfillAdminAuth,
  TicketMetadataBackfillController.triggerBackfill
);

export default router;
