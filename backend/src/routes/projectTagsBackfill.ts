import { Router, Request, Response, NextFunction } from 'express';
import { ProjectTagsBackfillController } from '@/controllers/projectTagsBackfillController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  authMiddleware.authenticate(req, res, next);
};

/**
 * @route POST /api/admin/project-tags-backfill
 * @desc Backfill project_tags and ticket_tag_mappings from ticket_tags table
 * @body { batchSize?: number, delayMs?: number } - defaults: 50, 1000ms
 * @access Authenticated users
 */
router.post(
  '/',
  requireAuth,
  ProjectTagsBackfillController.triggerBackfill
);

export default router;
