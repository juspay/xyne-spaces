import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { MessageMetadataBackfillController } from '@/controllers/messageMetadataBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();


const messageMetadataBackfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/message-metadata-backfill
 * @desc Backfill reactions_md and replies_md
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  messageMetadataBackfillAdminAuth,
  MessageMetadataBackfillController.triggerBackfill
);

export default router;
