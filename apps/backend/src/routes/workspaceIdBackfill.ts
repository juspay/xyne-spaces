import { Router } from 'express';
import { WorkspaceIdBackfillController } from '@/controllers/workspaceIdBackfillController';

const router = Router();

router.post('/', WorkspaceIdBackfillController.triggerBackfill);

export default router;
