import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { EmailReadAtBackfillController } from '@/controllers/emailReadAtBackfillController';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const router = Router();

const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route POST /migrate/api/admin/email-read-at-backfill
 * @desc One-time backfill of email_reads.lastReadEmailAt.
 *       Body: { batchSize?: number }  (default 25, batched over EMAIL channels)
 *       Run BEFORE writers stop maintaining lastReadEmailId.
 * @access TICKET-MIGRATION Admin only
 */
router.post(
  '/',
  authMiddleware.authenticate,
  adminAuth,
  EmailReadAtBackfillController.triggerBackfill,
);

export default router;
