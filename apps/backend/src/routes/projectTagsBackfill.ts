import { Router } from 'express';
import { ProjectTagsBackfillController } from '@/controllers/projectTagsBackfillController';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';

const router = Router();

/**
 * @route POST /api/admin/project-tags-backfill
 * @desc Backfill project_tags and ticket_tag_mappings from ticket_tags table
 * @body { batchSize?: number, delayMs?: number } - defaults: 50, 1000ms
 * @access Admin (TICKET-MIGRATION ADMIN)
 */
router.post(
  '/',
  ...backfillAdminAuth,
  ProjectTagsBackfillController.triggerBackfill
);

export default router;
