import { defineRouter } from '../../enc-contracts/api-route.js';
import { notificationsDismiss, notificationsMarkAllRead, notificationsMobileRegister, notificationsMobileUnregister, notificationsPreferences, notificationsPreferencesSet, notificationsQueueStats, notificationsRead, notificationsSubscribe, notificationsTest, notificationsUnreadCount, notificationsUnsubscribe, notificationsWorkspaceCounts } from './notifications.contracts.js';

/** `/notifications`: subscriptions, counts, marks, preferences (literal paths before `/:id/...`). Key order is the mount order. */
export const notificationsRouter = defineRouter('/notifications', {
  subscribe: notificationsSubscribe,
  unsubscribe: notificationsUnsubscribe,
  mobileRegister: notificationsMobileRegister,
  mobileUnregister: notificationsMobileUnregister,
  queueStats: notificationsQueueStats,
  unreadCount: notificationsUnreadCount,
  workspaceCounts: notificationsWorkspaceCounts,
  test: notificationsTest,
  markAllRead: notificationsMarkAllRead,
  preferences: notificationsPreferences,
  preferencesSet: notificationsPreferencesSet,
  read: notificationsRead,
  dismiss: notificationsDismiss,
});
