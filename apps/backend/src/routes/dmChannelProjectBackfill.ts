import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { DmChannelProjectBackfillController } from '@/controllers/dmChannelProjectBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const dmChannelProjectBackfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /migrate/api/admin/dm-channel-project-backfill
 * @desc Backfill DM channels with projectId = "default" to their workspace DM project.
 *       Body: { dryRun?: boolean }
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  dmChannelProjectBackfillAdminAuth,
  DmChannelProjectBackfillController.triggerBackfill,
);

export default router;
