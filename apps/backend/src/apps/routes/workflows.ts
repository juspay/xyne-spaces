import { Router } from 'express';
import { requirePermission } from '@/middleware/requirePermission';
import { workflowsAppRouter } from '@/workflowsV2/router';

const router = Router();

// Seeded by scripts/seed-app-permissions.ts locally and the 20260903000000 migration elsewhere.
router.use(requirePermission('workflows:start'), workflowsAppRouter);

export default router;
