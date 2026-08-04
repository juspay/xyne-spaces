import { Router } from 'express';
import { CallParticipantCountBackfillController } from '@/controllers/callParticipantCountBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @route POST /api/admin/call-participant-count-backfill
 * @desc Backfill calls.participantCount from call_participants
 * @body { batchSize?: number, delayMs?: number, dryRun?: boolean }
 * @access Admin (TICKET-MIGRATION ADMIN)
 */
router.post(
  '/',
  ...backfillAdminAuth,
  CallParticipantCountBackfillController.triggerBackfill,
);

export default router;
