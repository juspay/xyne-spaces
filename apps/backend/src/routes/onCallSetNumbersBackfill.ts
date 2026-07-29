import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { OnCallSetNumbersBackfillController } from '@/controllers/onCallSetNumbersBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const onCallSetNumbersBackfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /migrate/api/admin/on-call-set-numbers-backfill
 * @desc Backfill onCallSetNumbers from onCallSetNumber in user_group_mappings
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  onCallSetNumbersBackfillAdminAuth,
  OnCallSetNumbersBackfillController.triggerBackfill
);

export default router;
