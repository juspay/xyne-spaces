import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { labelDelete, labelDeleteImpact, labelUnreadCount, labelUnreadCounts } from '@/handlers/workspace';

// Typed routes (API.conversationLabels), served by the API router behind the contract gate.
api.routes(API.conversationLabels, (serve) => ({
  unreadCounts: serve('unreadCounts', { handle: ({ query, user }) => labelUnreadCounts({ query, user }) }),
  unreadCount: serve('unreadCount', { handle: ({ body, user }) => labelUnreadCount({ body, user }) }),
  deleteImpact: serve('deleteImpact', { handle: ({ params, user }) => labelDeleteImpact({ params, user }) }),
  delete: serve('delete', { handle: ({ params, user }) => labelDelete({ params, user }) }),
}));

// Nothing untyped left under /api/conversation-labels.
const router = Router();
export default router;
