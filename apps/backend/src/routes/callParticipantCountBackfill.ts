import { Router } from 'express';
import { CallParticipantCountBackfillController } from '@/controllers/callParticipantCountBackfillController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();


/**
 * @route POST /api/admin/call-participant-count-backfill
 * @desc Backfill calls.participantCount from call_participants
 * @body { batchSize?: number, delayMs?: number, dryRun?: boolean }
 */
router.post(
  '/',
  authMiddleware.authenticate,
  CallParticipantCountBackfillController.triggerBackfill,
);

export default router;
