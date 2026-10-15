import notifee, { EventType, type Event } from 'react-native-notify-kit';
import { Platform } from 'react-native';

import { ACTION_MARK_AS_READ, ACTION_REPLY } from '../config';
import { queueNonChatNotificationNavigationFromData, queueTapNavigation } from '../tapNavigation';
import {
  extractMessageContext,
  normalizeData,
  prepareTrayDataForEvent,
  resolveReplyTarget,
} from '../message/messageContext';
import { clearMessageGroup, clearMessageGroupByNotificationId } from '../message/messageStore';
import { markAsRead, sendReply } from '../backend/chatActionsApi';
import type { ParsedMessage } from '../types';
import { handleSosTrayEvent } from '../sos';

// True when a displayed notification belongs to this conversation. On iOS, APNS
// bubbles use random system ids, so we match by threadId or by re-parsing the
// payload's storeKey.
function trayBelongsToConversation(
  notification: { id?: string; ios?: { threadId?: string }; data?: Record<string, unknown> },
  notificationId: string,
  storeKey: string,
): boolean {
  if (notification.ios?.threadId === notificationId) return true;
  const trayData = prepareTrayDataForEvent(notification.data);
  const parsed = trayData ? extractMessageContext(trayData) : null;
  return parsed?.storeKey === storeKey;
}

// True when this conversation still has a banner in the system tray. Android keys
// by notification id; iOS matches any stacked bubble (random APNS ids → match by
// threadId / storeKey). On error we assume visible so we never silently drop a
// legitimate edit/delete rewrite.
export async function isConversationTrayVisible(
  notificationId: string,
  storeKey: string,
): Promise<boolean> {
  try {
    const displayed = await notifee.getDisplayedNotifications();
    if (Platform.OS !== 'ios') {
      return displayed.some(({ notification }) => notification?.id === notificationId);
    }
    return displayed.some(({ notification }) =>
      trayBelongsToConversation(notification as never, notificationId, storeKey),
    );
  } catch {
    return true;
  }
}

// Remove a whole conversation from the system tray. Android cancels by id; iOS
// stacks per-message bubbles, so we cancel every bubble sharing the threadId.
export async function cancelConversationTray(
  notificationId: string,
  storeKey: string,
): Promise<void> {
  try {
    if (Platform.OS !== 'ios') {
      await notifee.cancelNotification(notificationId);
      return;
    }
    const displayed = await notifee.getDisplayedNotifications();
    const ids = displayed
      .filter(({ notification }) =>
        trayBelongsToConversation(notification as never, notificationId, storeKey),
      )
      .map(({ notification }) => notification?.id)
      .filter((id): id is string => Boolean(id));

    await Promise.all(ids.map(id => notifee.cancelNotification(id).catch(() => {})));
  } catch {
    // Tray cancel failed; best-effort.
  }
}

// Cancel a single bubble after MESSAGE_DELETED / before an edit rewrite. Matches
// Notifee bubbles (id === messageId) AND APNS bubbles (random id, messageId in payload).
export async function cancelIosBubbleByMessageId(
  notificationId: string,
  storeKey: string,
  messageId: string,
): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const displayed = await notifee.getDisplayedNotifications();
    const ids = new Set<string>([messageId]);

    for (const { notification } of displayed) {
      const id = notification?.id;
      if (!id) continue;
      if (id === messageId) {
        ids.add(id);
        continue;
      }
      if (!trayBelongsToConversation(notification as never, notificationId, storeKey)) continue;

      const trayData = prepareTrayDataForEvent(notification.data as Record<string, unknown>);
      if (trayData && extractMessageContext(trayData)?.messageId === messageId) {
        ids.add(id);
      }
    }

    await Promise.all([...ids].map(id => notifee.cancelNotification(id).catch(() => {})));
  } catch {
    // Bubble cancel failed; best-effort.
  }
}

// Security (bug bounty #43): on Android the action payload arrives through an Intent,
// so its notification data cannot be trusted on its own. Only act when a notification
// with this id is actually showing in our tray, and use the copy we posted ourselves.
async function resolveDisplayedAndroidMessage(
  notificationId: string,
  claimed: ParsedMessage,
): Promise<ParsedMessage | null> {
  try {
    const displayed = await notifee.getDisplayedNotifications();
    const match = displayed.find(({ notification }) => notification?.id === notificationId);
    if (!match?.notification) return null;

    const trayData = prepareTrayDataForEvent(
      match.notification.data as Record<string, unknown> | undefined,
    );
    const message = trayData ? extractMessageContext(trayData) : null;
    if (!message || message.storeKey !== claimed.storeKey) return null;
    return message;
  } catch {
    return null;
  }
}

// Req #4: every interaction wipes the stored group so future pushes start fresh.
async function clearAfterInteraction(message: ParsedMessage, cancelTray: boolean): Promise<void> {
  clearMessageGroup(message.storeKey);
  if (cancelTray) await cancelConversationTray(message.notificationId, message.storeKey);
}

// User typed a reply on the notification.
async function handleReply(message: ParsedMessage, input: string): Promise<void> {
  const text = input.trim();
  if (!text) return;

  const target = resolveReplyTarget(message);
  if (!target) {
    return;
  }

  try {
    await sendReply(target, text);
  } catch {
    return; // keep the notification so the user can retry
  }
  await clearAfterInteraction(message, true);
}

// User tapped "Mark as read".
async function handleMarkAsRead(message: ParsedMessage): Promise<void> {
  if (message.backendNotificationId) {
    try {
      await markAsRead({
        backendNotificationId: message.backendNotificationId,
        ...(message.isThread && message.conversationId
          ? { channelId: message.channelId, conversationId: message.conversationId }
          : { channelId: message.channelId }),
      });
    } catch {
      // still clear locally
    }
  }
  await clearAfterInteraction(message, true);
}

/**
 * THE single entry for every tray event (foreground + background/killed).
 * Ignores non-v4 / non-chat notifications.
 */
export async function handleTrayEvent(event: Event): Promise<void> {
  if (await handleSosTrayEvent(event)) {
    return;
  }

  const { type, detail } = event;
  const notification = detail.notification;
  if (!notification?.id) return;

  const rawTrayData = normalizeData(notification.data as Record<string, unknown> | undefined);
  const trayData = prepareTrayDataForEvent(
    notification.data as Record<string, unknown> | undefined,
  );
  const message = trayData ? extractMessageContext(trayData) : null;

  // Swipe-away: clear the group even if we couldn't parse the payload.
  if (type === EventType.DISMISSED) {
    if (message) clearMessageGroup(message.storeKey);
    else clearMessageGroupByNotificationId(notification.id);
    return;
  }

  if (!message) {
    if (type === EventType.PRESS) {
      queueNonChatNotificationNavigationFromData(rawTrayData);
    }
    return;
  }

  // Body tap → clear + cancel (navigation is step 3; app opens normally).
  if (type === EventType.PRESS) {
    await queueTapNavigation(message);
    await clearAfterInteraction(message, true);
    return;
  }

  // Action button tap.
  if (type === EventType.ACTION_PRESS) {
    const actionId = detail.pressAction?.id;
    if (!actionId) return;

    const target =
      Platform.OS === 'android'
        ? await resolveDisplayedAndroidMessage(notification.id, message)
        : message;
    // Not one of our displayed notifications: a forged or stale action. Ignore it.
    if (!target) return;

    if (actionId === ACTION_REPLY) await handleReply(target, detail.input ?? '');
    else if (actionId === ACTION_MARK_AS_READ) await handleMarkAsRead(target);
  }
}

// Foreground EventBus is bound in index.js (same as background) so PRESS is
// not dropped when MainActivity restarts before NotificationService.start().
// Binding again here would handle the same tap twice and double-push chat.
export function registerForegroundTrayEvents(): () => void {
  return (): void => {
    // Process-level subscription is owned by index.js for the JS runtime.
  };
}
