import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { authorize } from '@/middleware/authorize';
import { AiProvisioningBackfillController } from '@/controllers/aiProvisioningBackfillController';

const router = Router();

const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

/**
 * @route   GET /api/admin/ai-provisioning-backfill
 * @desc    Get provisioning status (total, provisioned, unprovisioned per subject type)
 * @access  TICKET-MIGRATION Admin only
 */
router.get('/', adminAuth, AiProvisioningBackfillController.getStatus);

/**
 * @route   POST /api/admin/ai-provisioning-backfill
 * @desc    Backfill AI (LiteLLM) provisioning for existing orgs, workspaces, or users
 * @access  TICKET-MIGRATION Admin only
 *
 * @body    mode      - 'orgs' | 'workspaces' | 'users' (required)
 *          dryRun    - if true, don't execute, just count (default false)
 *          batchSize - users only: parallel batch size (default 5)
 */
router.post('/backfill', adminAuth, AiProvisioningBackfillController.triggerBackfill);

export default router;
