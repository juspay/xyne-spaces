import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { EmailChannelUnreadBackfillController } from '@/controllers/emailChannelUnreadBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /migrate/api/admin/email-channel-unread-backfill
 * @desc Reconcile channel_user_status.unreadCount for email channels.
 *       Body: { channelId?: string, dryRun?: boolean }
 *       Without channelId: backfills all EMAIL channels.
 *       With dryRun: rolls back the transaction (no rows modified).
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  adminAuth,
  EmailChannelUnreadBackfillController.triggerBackfill,
);

export default router;
