import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { DualWriteSequenceNumberBackfillController } from '@/controllers/dualWriteSequenceNumberBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const dualWriteSequenceNumberBackfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/dual-write-sequence-number-backfill
 * @desc Move project ticket sequence state from the main DB into the common DB
 *       entity_sequences table in batches.
 *       Idempotent; never lowers an already-advanced counter.
 * @access TICKET-MIGRATION Admin only
 * @body { entityType: 'PROJECT_TICKET',
 *         batchSize?: number, delayMs?: number, dryRun?: boolean }
 */
router.post(
  '/',
  authMiddleware.authenticate,
  dualWriteSequenceNumberBackfillAdminAuth,
  DualWriteSequenceNumberBackfillController.triggerBackfill
);

export default router;
