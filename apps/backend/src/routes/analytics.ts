import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { MultiPullRequestController } from '../controllers/multiPullRequestController';
import { authorize } from '../middleware/authorize';
import { aclMiddleware } from '../middleware/acl';
import { analyticsAuthMiddleware } from '../middleware/analyticsAuth';

// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


// Not moved yet: the pull-request list (its response carries titles).
const router = Router();
const multiPullRequestController = new MultiPullRequestController();
const analyticsAuth = authorize('ANALYTICS', AccessType.ADMIN, false);
router.use(analyticsAuthMiddleware.requireWorkspaceContext);
router.get('/multi-pull-requests', aclMiddleware.checkAccess, analyticsAuth, multiPullRequestController.getAllPullRequests);

export default router;
