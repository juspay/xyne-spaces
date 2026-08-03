import { Router } from 'express';
import { FormFieldSequenceBackfillController } from '@/controllers/formFieldSequenceBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @route POST /migrate/api/admin/form-field-sequence-backfill
 * @desc Backfill deterministic sequenceNumber values for legacy form_fields rows
 * @access Admin (TICKET-MIGRATION ADMIN)
 * @body { batchSize?: number, delayMs?: number, dryRun?: boolean }
 */
router.post(
  '/',
  ...backfillAdminAuth,
  FormFieldSequenceBackfillController.triggerBackfill
);

export default router;
