import { Router, Request, Response, NextFunction } from 'express';
import { GmailWatchRenewalController } from '@/controllers/gmailWatchRenewalController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * @route POST /api/admin/gmail-watch-renewal
 * @desc Manually trigger a Gmail watch renewal run (admin only)
 */
router.post(
  '/',
  (req: Request, res: Response, next: NextFunction) => authMiddleware.authenticate(req, res, next),
  (req: Request, res: Response, next: NextFunction) => authMiddleware.requireAdmin(req, res, next),
  GmailWatchRenewalController.trigger,
);

export default router;
