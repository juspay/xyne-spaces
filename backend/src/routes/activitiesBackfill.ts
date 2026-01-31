import { Router, Request, Response, NextFunction } from 'express';
import { ActivitiesBackfillController } from '@/controllers/activitiesBackfillController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  // Always require authentication - no bypass for development/sandbox
  authMiddleware.authenticate(req, res, next);
};

/**
 * @route POST /api/admin/activities-backfill
 * @desc Trigger backfill for group mention actorAction
 * @access Authenticated users
 */
router.post(
  '/',
  requireAuth,
  ActivitiesBackfillController.triggerBackfill
);

export default router;
