import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { ConversationParticipantBackfillController } from '@/controllers/conversationParticipantBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const backfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/conversation-participant-backfill
 * @desc Backfill lastActivityAt and channelId on conversation_participants
 * @access TICKET-MIGRATION Admin only
 * @body { types?: ('lastActivityAt' | 'channelId')[], batchSize?: number, delayMs?: number, dryRun?: boolean }
 */
router.post(
  '/',
  authMiddleware.authenticate,
  backfillAdminAuth,
  ConversationParticipantBackfillController.triggerBackfill
);

export default router;
