import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { ConversationParticipantBackfillController } from '@/controllers/conversationParticipantBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const backfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /migrate/api/admin/conversation-participant-backfill
 * @desc Backfill or reconcile denormalized conversation_participant fields
 * @access TICKET-MIGRATION Admin only
 * @body {
 *   types?: (
 *     | 'lastReplyAt'
 *     | 'legacyLastReadAt'
 *     | 'staleLastReplyAt'
 *     | 'channelId'
 *     | 'orphanedParticipants'
 *   )[],
 *   lastReadAtCutoff?: string, // Required for legacyLastReadAt; valid timestamp
 *   batchSize?: number,
 *   delayMs?: number,
 *   dryRun?: boolean
 * }
 */
router.post(
  '/',
  authMiddleware.authenticate,
  backfillAdminAuth,
  ConversationParticipantBackfillController.triggerBackfill
);

export default router;
