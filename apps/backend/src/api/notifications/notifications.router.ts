import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { dismiss, getPreferences, markAllRead, markRead, queueStats, registerMobilePushToken, sendTest, subscribe, unreadCount, unregisterMobilePushToken, unsubscribe, updatePreferences, workspaceCounts } from './notifications.controller';

/** `/notifications` (login). The list itself is untyped (routes/notifications.ts). */
export const notificationsRouter = api.router(API.notifications, {}, (serve) => ({
  subscribe: serve('subscribe', { controller: ({ body, user, userAgent }) => subscribe({ body, user, userAgent }) }),
  unsubscribe: serve('unsubscribe', { controller: ({ body, user }) => unsubscribe({ body, user }) }),
  mobileRegister: serve('mobileRegister', { controller: ({ body, user, headers }) => registerMobilePushToken({ body, user, headers }) }),
  mobileUnregister: serve('mobileUnregister', { controller: ({ user, headers }) => unregisterMobilePushToken({ user, headers }) }),
  queueStats: serve('queueStats', { controller: () => queueStats() }),
  unreadCount: serve('unreadCount', { controller: ({ user }) => unreadCount({ user }) }),
  workspaceCounts: serve('workspaceCounts', { controller: ({ user }) => workspaceCounts({ user }) }),
  test: serve('test', { controller: ({ user }) => sendTest({ user }) }),
  markAllRead: serve('markAllRead', { controller: ({ user }) => markAllRead({ user }) }),
  preferences: serve('preferences', { controller: ({ user }) => getPreferences({ user }) }),
  preferencesSet: serve('preferencesSet', { controller: ({ body, user }) => updatePreferences({ body, user }) }),
  read: serve('read', { controller: ({ params, body, user }) => markRead({ params, body, user }) }),
  dismiss: serve('dismiss', { controller: ({ params, user }) => dismiss({ params, user }) }),
}));
