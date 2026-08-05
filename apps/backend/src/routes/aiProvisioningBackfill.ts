import { Router } from 'express';
import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';
import { AiProvisioningBackfillController } from '@/controllers/aiProvisioningBackfillController';

const router = Router();

/**
 * @route   GET /api/admin/ai-provisioning-backfill
 * @desc    Get provisioning status (total, provisioned, unprovisioned per subject type)
 * @access  TICKET-MIGRATION Admin only
 */
router.get('/', ...backfillAdminAuth, AiProvisioningBackfillController.getStatus);

/**
 * @route   POST /api/admin/ai-provisioning-backfill
 * @desc    Backfill AI (LiteLLM) provisioning for existing orgs, workspaces, or users
 * @access  TICKET-MIGRATION Admin only
 *
 * @body    mode      - 'orgs' | 'workspaces' | 'users' (required)
 *          dryRun    - if true, don't execute, just count (default false)
 *          batchSize - users only: parallel batch size (default 5)
 */
router.post('/', ...backfillAdminAuth, AiProvisioningBackfillController.triggerBackfill);

export default router;
