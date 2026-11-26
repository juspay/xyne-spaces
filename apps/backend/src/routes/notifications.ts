import { Router } from 'express';
import { API } from '@xyne/shared';
import { notificationController } from '@/controllers/notificationController';
import { api } from '@/framework/api';
import { authMiddleware } from '@/middleware/auth';
import {
  dismiss,
  getPreferences,
  markAllRead,
  markRead,
  queueStats,
  registerMobilePushToken,
  sendTest,
  subscribe,
  unreadCount,
  unregisterMobilePushToken,
  unsubscribe,
  updatePreferences,
  workspaceCounts,
} from '@/handlers/notifications';

// Typed routes (API.notifications), served by the API router behind the contract gate: dashboard
// login, then the handler. Order: literal paths before `/:id/...`.
api.routes(API.notifications, (serve) => ({
  subscribe: serve('subscribe', { handle: ({ body, user, userAgent }) => subscribe({ body, user, userAgent }) }),
  unsubscribe: serve('unsubscribe', { handle: ({ body, user }) => unsubscribe({ body, user }) }),
  mobileRegister: serve('mobileRegister', { handle: ({ body, user, headers }) => registerMobilePushToken({ body, user, headers }) }),
  mobileUnregister: serve('mobileUnregister', { handle: ({ user, headers }) => unregisterMobilePushToken({ user, headers }) }),
  queueStats: serve('queueStats', { handle: () => queueStats() }),
  unreadCount: serve('unreadCount', { handle: ({ user }) => unreadCount({ user }) }),
  workspaceCounts: serve('workspaceCounts', { handle: ({ user }) => workspaceCounts({ user }) }),
  test: serve('test', { handle: ({ user }) => sendTest({ user }) }),
  markAllRead: serve('markAllRead', { handle: ({ user }) => markAllRead({ user }) }),
  preferences: serve('preferences', { handle: ({ user }) => getPreferences({ user }) }),
  preferencesSet: serve('preferencesSet', { handle: ({ body, user }) => updatePreferences({ body, user }) }),
  read: serve('read', { handle: ({ params, body, user }) => markRead({ params, body, user }) }),
  dismiss: serve('dismiss', { handle: ({ params, user }) => dismiss({ params, user }) }),
}));

// Not moved: the list of notifications (titles and message text).
const router = Router();
router.use(authMiddleware.authenticate);
router.get('/', notificationController.getNotifications);

export default router;
