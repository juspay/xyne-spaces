import express from 'express';
import { workspaceJoinRequestController } from '@/controllers/workspaceJoinRequestController';
import { authMiddleware } from '@/middleware/auth';

const router = express.Router();

router.get('/', authMiddleware.authenticate, workspaceJoinRequestController.listOrgJoinRequests);
router.post('/:workspaceId', workspaceJoinRequestController.requestJoin);
router.post(
  '/:workspaceId/:requestId/review',
  authMiddleware.authenticate,
  workspaceJoinRequestController.reviewJoinRequest
);

export default router;

// Paths the mobile app and older desktop bundles still call; remove once they have moved to /api/join-requests.
export const legacyJoinRequestRouter = express.Router();

legacyJoinRequestRouter.post('/:workspaceId/join', workspaceJoinRequestController.requestJoin);
legacyJoinRequestRouter.get(
  '/join-requests',
  authMiddleware.authenticate,
  workspaceJoinRequestController.listOrgJoinRequests
);
legacyJoinRequestRouter.post(
  '/:workspaceId/join-requests/:requestId/review',
  authMiddleware.authenticate,
  workspaceJoinRequestController.reviewJoinRequest
);
