import { lotusStorage } from '@/src/services/localStorage';

import { isPauseActive } from '@/src/utils/pauseNotifications';

/**
 * Local copy of the current user's pause expiry. Backend
 * `notificationFilterService` is the source of truth for push send, but the
 * app still presents some banners itself (foreground JS, Android data-only).
 * This key lets that path honor the same expiry without reading Zero.
 */
export const NOTIFICATIONS_PAUSED_UNTIL_KEY = 'xyne-global:notificationsPausedUntil';

export function readNotificationsPausedUntil(): number | null {
  const raw = lotusStorage.getString(NOTIFICATIONS_PAUSED_UNTIL_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function writeNotificationsPausedUntil(until: number | null): void {
  if (until === null) {
    lotusStorage.remove(NOTIFICATIONS_PAUSED_UNTIL_KEY);
    return;
  }
  lotusStorage.set(NOTIFICATIONS_PAUSED_UNTIL_KEY, String(until));
}

export function isNotificationsPaused(now = Date.now()): boolean {
  return isPauseActive(readNotificationsPausedUntil(), now);
}
