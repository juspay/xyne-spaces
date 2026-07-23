import express from 'express';
import { communityWorkspaceController } from '@/controllers/communityWorkspaceController';
import { authMiddleware } from '@/middleware/auth';

const router = express.Router();

router.get('/workspaces', communityWorkspaceController.listCommunityWorkspaces);
router.post('/:workspaceId/join', communityWorkspaceController.joinCommunityWorkspace);
router.get(
  '/join-requests',
  authMiddleware.authenticate,
  communityWorkspaceController.listOrgJoinRequests
);
router.post(
  '/:workspaceId/join-requests/:requestId/review',
  authMiddleware.authenticate,
  communityWorkspaceController.reviewJoinRequest
);

export default router;
