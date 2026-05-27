import { Router, Request, Response, NextFunction } from 'express';
import { ActivityThreadBackfillController } from '@/controllers/activityThreadBackfillController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  authMiddleware.authenticate(req, res, next);
};

/**
 * @route POST /api/admin/activity-thread-backfill
 * @desc Backfill isThreadActivity column on activities table
 * @body { batchSize?: number, delayMs?: number } - defaults: 50, 1000ms
 * @access Authenticated users
 */
router.post(
  '/',
  requireAuth,
  ActivityThreadBackfillController.triggerBackfill
);

export default router;
