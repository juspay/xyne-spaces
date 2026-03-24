import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { SetUpdatedAtTimeController } from '@/controllers/setUpdatedAtTimeController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const setUpdatedAtTimeAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/set-updated-at-time
 * @desc Backfill activities.updatedAt to match createdAt
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  setUpdatedAtTimeAdminAuth,
  SetUpdatedAtTimeController.triggerBackfill
);

export default router;
