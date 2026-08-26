import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { AnalyticsController } from '../controllers/analyticsController';
import { authorize } from '../middleware/authorize';
import { aclMiddleware } from '../middleware/acl';
import { analyticsAuthMiddleware } from '../middleware/analyticsAuth';

const router = Router();
const analyticsController = new AnalyticsController();

// Apply ANALYTICS authorization to all routes - INDIVIDUAL USER ACCESS ONLY (no group access)
const analyticsAuth = authorize('ANALYTICS', AccessType.ADMIN, false);

router.use(analyticsAuthMiddleware.requireWorkspaceContext);

// Messages exchanged endpoint
router.get('/messages-exchanged', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getMessagesExchanged);

// Active users endpoint
router.get('/active-users', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getActiveUsers);

// Current active users endpoint
router.get('/current-active-users', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getCurrentActiveUsers);

// Active channels endpoint
router.get('/active-channels', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getActiveChannels);

// Files shared endpoint
router.get('/files-shared', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getFilesShared);

// Messages today endpoint
router.get('/messages-today', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getMessagesToday);

// Number of tickets endpoint
router.get('/number-of-tickets', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getNumberOfTickets);

// Number of canvases endpoint
router.get('/number-of-canvases', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getNumberOfCanvases);

// Number of calls endpoint
router.get('/number-of-calls', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getNumberOfCalls);

// Total duration of calls endpoint
router.get('/total-calls-duration', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getTotalCallsDuration);

// Users onboarded endpoint
router.get('/users-onboarded', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getUsersOnboarded);

// Top users by messages endpoint
router.get('/top-users-by-messages', aclMiddleware.checkAccess, analyticsAuth, analyticsController.getTopUsersByMessages);

export default router;
