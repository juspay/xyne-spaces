import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { FormFieldSequenceBackfillController } from '@/controllers/formFieldSequenceBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const formFieldSequenceBackfillAdminAuth = authorize('FORMS', AccessType.ADMIN);

/**
 * @route POST /migrate/api/admin/form-field-sequence-backfill
 * @desc Backfill deterministic sequenceNumber values for legacy form_fields rows
 * @access FORMS Admin only
 * @body { batchSize?: number, delayMs?: number, dryRun?: boolean }
 */
router.post(
  '/',
  authMiddleware.authenticate,
  formFieldSequenceBackfillAdminAuth,
  FormFieldSequenceBackfillController.triggerBackfill
);

export default router;
