import { Router } from 'express';
import { ActivitiesBackfillController } from '@/controllers/activitiesBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @route POST /api/admin/activities-backfill
 * @desc Trigger backfill for group mention actorAction
 * @access Admin (TICKET-MIGRATION ADMIN)
 */
router.post(
  '/',
  ...backfillAdminAuth,
  ActivitiesBackfillController.triggerBackfill
);

export default router;
