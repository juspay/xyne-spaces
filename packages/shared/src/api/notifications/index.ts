import { route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';

// ─── Notifications (/notifications/...): dashboard login. Subscriptions, unread counts, ───
// ─── read and dismiss marks, and preferences. The list of notifications (titles and ──────
// ─── message text) is not here. Nothing encrypted. ──────────────────────────────────────

const success = z.object({ success: z.literal(true) });

const MIN_FCM_TOKEN_LENGTH = 100;

const NOTIFICATION_TYPES = [
  'TICKET_STATUS_CHANGE',
  'TICKET_ASSIGNMENT',
  'TICKET_REASSIGNMENT',
  'TICKET_DUE_DATE_CHANGED',
  'TICKET_PRIORITY_CHANGED',
  'TICKET_USER_GROUP_CHANGED',
  'TICKET_TITLE_CHANGED',
  'TICKET_DESCRIPTION_CHANGED',
  'TICKET_RCA_CREATED',
  'TICKET_RCA_UPDATED',
  'TICKET_SUBTICKET_ADDED',
  'TICKET_RELATED_TICKET_ADDED',
  'TICKET_RELATED_TICKET_REMOVED',
  'CHANNEL_MESSAGE',
  'MENTION',
  'WORKFLOW_COMPLETION',
  'WORKFLOW_FAILURE',
] as const;

/** `/notifications`: subscriptions, counts, marks, preferences (literal paths before `/:id/...`). Key order is the mount order. */
export const notifications = route('/notifications', {
  subscribe: {
    method: 'POST',
    path: '/subscribe',
    body: z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string(), auth: z.string() }),
    }),
    response: success,
  },
  unsubscribe: {
    method: 'DELETE',
    path: '/unsubscribe',
    body: z.object({ endpoint: z.string().url() }),
    response: success,
  },
  mobileRegister: {
    method: 'POST',
    path: '/mobile/register',
    body: z.object({
      fcmToken: z.string().min(MIN_FCM_TOKEN_LENGTH),
      voipToken: z.string().optional(),
      platform: z.enum(['ios', 'android', 'unknown']).default('unknown'),
      deviceId: z.string().max(255).optional(),
    }),
    response: success,
  },
  mobileUnregister: {
    method: 'POST',
    path: '/mobile/unregister',
    body: z.object({}).strict(),
    response: success,
  },
  queueStats: {
    method: 'GET',
    path: '/queue-stats',
    // Passthrough: the real-time service's own stats (typed `any` there), so no shape to pin.
    response: z.record(z.string(), z.unknown()),
  },
  unreadCount: {
    method: 'GET',
    path: '/unread-count',
    response: z.object({ count: z.number() }),
  },
  workspaceCounts: {
    method: 'GET',
    path: '/workspace-counts',
    response: z.object({ counts: z.array(z.object({ workspaceId: z.string(), userId: z.string(), count: z.number() })) }),
  },
  test: {
    method: 'POST',
    path: '/test',
    response: z.object({ success: z.literal(true), message: z.string() }),
  },
  markAllRead: {
    method: 'PATCH',
    path: '/mark-all-read',
    response: success,
  },
  preferences: {
    method: 'GET',
    path: '/preferences',
    response: z.record(z.string(), z.object({ browserEnabled: z.boolean(), emailEnabled: z.boolean(), slackEnabled: z.boolean() })),
  },
  /** Keys that are not a known notification type are dropped first (old types such as SYSTEM_ALERTS), then the rest are checked. */
  preferencesSet: {
    method: 'PUT',
    path: '/preferences',
    body: z.preprocess(
      (value) =>
        value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).filter(([key]) => (NOTIFICATION_TYPES as readonly string[]).includes(key)))
          : value,
      z.record(
        z.enum(NOTIFICATION_TYPES),
        z.object({ browserEnabled: z.boolean(), emailEnabled: z.boolean(), slackEnabled: z.boolean() }),
      ),
    ),
    response: success,
  },
  read: {
    method: 'PATCH',
    path: '/:id/read',
    params: z.object({ id: z.string() }),
    body: z.object({ channelId: z.unknown().optional(), conversationId: z.unknown().optional() }),
    response: success,
  },
  dismiss: {
    method: 'PATCH',
    path: '/:id/dismiss',
    params: z.object({ id: z.string() }),
    response: success,
  },
});
