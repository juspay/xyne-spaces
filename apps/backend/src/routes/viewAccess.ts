import { Router } from 'express';
import { viewAccessController } from '@/controllers/viewAccessController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

router.use(authMiddleware.authenticate);

// GET /api/views/:viewId/access → { ownerId, grants: [{ id, entityType, entityId, sharedBy }] }
router.get('/:viewId/access', viewAccessController.getAccessList);

export default router;
