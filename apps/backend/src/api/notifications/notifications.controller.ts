import { api, NotificationType } from '@xyne/shared';
import { ContractError, controller } from '@/framework/api';
import { deviceKeyFromHeaders } from '@/services/authSessionService';
import { notificationService } from '@/services/notificationService';
import { unreadService } from '@/services/unreadService';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';

/**
 * The notification settings and counters API on the typed framework (routes/notifications.ts):
 * no req/res, same answers as the NotificationController methods they replace.
 */

const unauthorized = () => new ContractError(401, { error: 'Unauthorized' });
const internal = (error: unknown, logMessage: string): ContractError => {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, { error: 'Internal server error' });
};
const requireUserId = (user: AuthenticatedUser | undefined): string => {
  if (!user?.id) throw unauthorized();
  return user.id;
};
const ok = { success: true as const };

/** POST /notifications/subscribe: a browser push subscription. */
export const subscribe = controller(api.notifications.subscribe, async (input) => {
  try {
    const userId = requireUserId(input.user);
    await notificationService.saveSubscription(userId, {
      endpoint: input.body.endpoint,
      p256dh: input.body.keys.p256dh,
      auth: input.body.keys.auth,
      userAgent: input.userAgent || undefined,
    });
    return ok;
  } catch (error) {
    throw internal(error, 'Failed to save notification subscription:');
  }
});

/** DELETE /notifications/unsubscribe */
export const unsubscribe = controller(api.notifications.unsubscribe, async (input) => {
  try {
    await notificationService.removeSubscription(requireUserId(input.user), input.body.endpoint);
    return ok;
  } catch (error) {
    throw internal(error, 'Failed to remove notification subscription:');
  }
});

/** POST /notifications/mobile/register: a push token, tied to this login session and device. */
export const registerMobilePushToken = controller(api.notifications.mobileRegister, async (input) => {
  try {
    const userId = requireUserId(input.user);
    const sessionId = input.user?.sid;
    if (!sessionId) {
      logger.error('Failed to register mobile push token: No session ID found');
      throw unauthorized();
    }
    await notificationService.registerMobilePushToken(userId, {
      ...input.body,
      sessionId,
      appVersion: input.headers['x-app-version'] as string | undefined,
      orgMemberId: input.user?.memberId,
      deviceKey: deviceKeyFromHeaders(input.headers),
    });
    return ok;
  } catch (error) {
    throw internal(error, 'Failed to register mobile push token:');
  }
});

/** POST /notifications/mobile/unregister */
export const unregisterMobilePushToken = controller(api.notifications.mobileUnregister, async (input) => {
  try {
    const userId = requireUserId(input.user);
    await notificationService.unregisterMobilePushToken(userId, input.user?.sid ?? undefined, {
      orgMemberId: input.user?.memberId,
      deviceKey: deviceKeyFromHeaders(input.headers),
    });
    return ok;
  } catch (error) {
    throw internal(error, 'Failed to unregister mobile push token:');
  }
});

/** GET /notifications/queue-stats */
export const queueStats = controller(api.notifications.queueStats, async () => {
  try {
    const stats = await notificationService.getStats();
    if (!stats) throw new ContractError(500, { error: 'Failed to retrieve queue stats' });
    return stats;
  } catch (error) {
    throw internal(error, 'Failed to get queue stats:');
  }
});

/** GET /notifications/unread-count */
export const unreadCount = controller(api.notifications.unreadCount, async (input) => {
  try {
    return { count: await notificationService.getUnreadCount(requireUserId(input.user)) };
  } catch (error) {
    throw internal(error, 'Failed to get unread notification count:');
  }
});

/** GET /notifications/workspace-counts: by the org member, so every workspace of the person. */
export const workspaceCounts = controller(api.notifications.workspaceCounts, async (input) => {
  try {
    const memberId = input.user?.memberId;
    if (!memberId) throw unauthorized();
    return { counts: await notificationService.getWorkspaceNotificationCounts(memberId) };
  } catch (error) {
    throw internal(error, 'Failed to get workspace notification counts:');
  }
});

/** POST /notifications/test: makes a test notification for the caller. */
export const sendTest = controller(api.notifications.test, async (input) => {
  try {
    const userId = requireUserId(input.user);
    await notificationService.createNotification(userId, {
      title: 'Test Notification',
      message: 'This is a test notification from Xyne Spaces',
      type: NotificationType.WORKFLOW_COMPLETION,
      relatedEntityType: 'test',
      relatedEntityId: 'test-' + Date.now(),
      actionUrl: `/${input.user!.workspaceId}/notifications`,
    });
    return { success: true as const, message: 'Test notification created successfully' };
  } catch (error) {
    throw internal(error, 'Failed to send test notification:');
  }
});

/** PATCH /notifications/mark-all-read */
export const markAllRead = controller(api.notifications.markAllRead, async (input) => {
  try {
    await notificationService.markAllAsRead(requireUserId(input.user));
    return ok;
  } catch (error) {
    throw internal(error, 'Failed to mark all notifications as read:');
  }
});

/** PATCH /notifications/:id/read: also marks the channel and thread the notification was opened from as viewed. */
export const markRead = controller(api.notifications.read, async (input) => {
  try {
    const userId = requireUserId(input.user);
    const { channelId, conversationId } = input.body;
    await notificationService.markAsRead(input.params.id, userId);
    if (typeof channelId === 'string' && channelId.length > 0) await unreadService.markChannelAsViewed(channelId, userId);
    if (typeof conversationId === 'string' && conversationId.length > 0) await unreadService.markThreadAsViewed(conversationId, userId);
    return ok;
  } catch (error) {
    throw internal(error, 'Failed to mark notification as read:');
  }
});

/** PATCH /notifications/:id/dismiss */
export const dismiss = controller(api.notifications.dismiss, async (input) => {
  try {
    await notificationService.dismiss(input.params.id, requireUserId(input.user));
    return ok;
  } catch (error) {
    throw internal(error, 'Failed to dismiss notification:');
  }
});

/** GET /notifications/preferences */
export const getPreferences = controller(api.notifications.preferences, async (input) => {
  try {
    return await notificationService.getUserPreferences(requireUserId(input.user));
  } catch (error) {
    throw internal(error, 'Failed to get notification preferences:');
  }
});

/** PUT /notifications/preferences (unknown notification types were already dropped by the contract). */
export const updatePreferences = controller(api.notifications.preferencesSet, async (input) => {
  try {
    await notificationService.updateUserPreferences(requireUserId(input.user), input.body);
    return ok;
  } catch (error) {
    throw internal(error, 'Failed to update notification preferences:');
  }
});