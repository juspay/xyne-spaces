import { Router } from 'express';
import { AccessType, API } from '@xyne/shared';
import { MultiPullRequestController } from '../controllers/multiPullRequestController';
import { authorize } from '../middleware/authorize';
import { aclMiddleware } from '../middleware/acl';
import { analyticsAuthMiddleware } from '../middleware/analyticsAuth';
import { api } from '@/framework/api';
import { analyticsWorkspace, resourceAccess, routeAcl } from '@/framework/dashboardAccess';
import {
  activeChannels,
  activeUsers,
  currentActiveUsers,
  filesShared,
  messagesExchanged,
  messagesToday,
  numberOfCalls,
  numberOfCanvases,
  numberOfTickets,
  topUsersByMessages,
  totalCallsDuration,
  usersOnboarded,
} from '@/handlers/analytics';

// Typed routes (API.analytics), served by the API router behind the contract gate. Every one runs
// the same three checks, in this order: a workspace is present, the route ACL, then ANALYTICS
// admin (INDIVIDUAL USER ACCESS ONLY, no group access).
const analyticsChecks = {
  access: {
    workspace: analyticsWorkspace(),
    acl: routeAcl(),
    analytics: resourceAccess('ANALYTICS', AccessType.ADMIN),
  },
};

api.routes(API.analytics, (serve) => ({
  messagesExchanged: serve('messagesExchanged', { ...analyticsChecks, handle: ({ query, user }) => messagesExchanged({ query, user }) }),
  activeUsers: serve('activeUsers', { ...analyticsChecks, handle: ({ query, user }) => activeUsers({ query, user }) }),
  currentActiveUsers: serve('currentActiveUsers', { ...analyticsChecks, handle: ({ query, user }) => currentActiveUsers({ query, user }) }),
  activeChannels: serve('activeChannels', { ...analyticsChecks, handle: ({ query, user }) => activeChannels({ query, user }) }),
  filesShared: serve('filesShared', { ...analyticsChecks, handle: ({ query, user }) => filesShared({ query, user }) }),
  messagesToday: serve('messagesToday', { ...analyticsChecks, handle: ({ query, user }) => messagesToday({ query, user }) }),
  numberOfTickets: serve('numberOfTickets', { ...analyticsChecks, handle: ({ query, user }) => numberOfTickets({ query, user }) }),
  numberOfCanvases: serve('numberOfCanvases', { ...analyticsChecks, handle: ({ query, user }) => numberOfCanvases({ query, user }) }),
  numberOfCalls: serve('numberOfCalls', { ...analyticsChecks, handle: ({ query, user }) => numberOfCalls({ query, user }) }),
  totalCallsDuration: serve('totalCallsDuration', { ...analyticsChecks, handle: ({ query, user }) => totalCallsDuration({ query, user }) }),
  usersOnboarded: serve('usersOnboarded', { ...analyticsChecks, handle: ({ query, user }) => usersOnboarded({ query, user }) }),
  topUsersByMessages: serve('topUsersByMessages', { ...analyticsChecks, handle: ({ query, user }) => topUsersByMessages({ query, user }) }),
}));

// Not moved yet: the pull-request list (its response carries titles).
const router = Router();
const multiPullRequestController = new MultiPullRequestController();
const analyticsAuth = authorize('ANALYTICS', AccessType.ADMIN, false);
router.use(analyticsAuthMiddleware.requireWorkspaceContext);
router.get('/multi-pull-requests', aclMiddleware.checkAccess, analyticsAuth, multiPullRequestController.getAllPullRequests);

export default router;
