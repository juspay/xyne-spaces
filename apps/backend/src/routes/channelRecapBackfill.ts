import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { ChannelRecapBackfillController } from '@/controllers/channelRecapBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const channelRecapBackfillAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /api/admin/channel-recap-backfill
 * @desc Backfill channel_recaps from channel_daily_recaps
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  channelRecapBackfillAdminAuth,
  ChannelRecapBackfillController.triggerBackfill
);

export default router;
