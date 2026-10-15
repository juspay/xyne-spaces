import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidStyle,
  AndroidVisibility,
  type AndroidAction,
  type Notification,
} from 'react-native-notify-kit';
import { Platform } from 'react-native';

import {
  ACTION_SOS_ACKNOWLEDGE,
  ACTION_DEFAULT,
  SOS_ALERT_CATEGORY_ID,
  SOS_ALERT_CHANNEL_ID,
  SOS_ALERT_NOTIFICATION_SOUND_ID,
  SOS_ALERT_NOTIFICATION_SOUND_IOS,
} from '../config';
import { ensureNotificationSetup, ensureSosAndroidChannel } from '../display/notificationSetup';
import {
  getAuthOperation,
  getAuthSessionGeneration,
  isAuthScopeCurrent,
} from '@/src/services/authSessionLifecycle';
import { buildSosTrayData, extractSosAlertFromTrayData } from './parser';
import { getOwnedSosAlert } from './store';
import type { SosAlert } from './types';

type PresentSosNotificationOptions = {
  waitForAndroidAutoDisplay?: boolean;
};

type VisibleNotificationLike = {
  id?: string | undefined;
  notification?:
    | {
        id?: string | undefined;
        title?: string | undefined;
        body?: string | undefined;
        data?: unknown;
      }
    | undefined;
};

const ANDROID_SOS_ACTIONS: AndroidAction[] = [
  {
    title: 'Acknowledge',
    pressAction: { id: ACTION_SOS_ACKNOWLEDGE },
  },
];

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isSameVisibleSosAlert(displayed: VisibleNotificationLike, alert: SosAlert): boolean {
  if (displayed.id === alert.id || displayed.notification?.id === alert.id) return true;

  const trayAlert = extractSosAlertFromTrayData(
    displayed.notification?.data as Record<string, unknown> | undefined,
  );
  if (trayAlert?.id === alert.id) return true;

  return (
    displayed.notification?.title === alert.title && displayed.notification?.body === alert.body
  );
}

async function isSosNotificationVisible(alert: SosAlert): Promise<boolean> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return true;

  // Native notification state can settle just after the display promise.
  const retryDelays = Platform.OS === 'ios' ? [0, 150, 400] : [0, 50, 150];
  for (const waitMs of retryDelays) {
    if (waitMs > 0) await delay(waitMs);
    const displayed = await notifee.getDisplayedNotifications();
    if (displayed.some(item => isSameVisibleSosAlert(item, alert))) return true;
  }

  return false;
}

function isAdmittedSosScope(alert: SosAlert, generation: number, operation: number): boolean {
  return (
    isAuthScopeCurrent(generation, operation) &&
    Boolean(alert.ownerUserId) &&
    getOwnedSosAlert(alert.id)?.ownerUserId === alert.ownerUserId
  );
}

async function displaySosNotification(alert: SosAlert): Promise<void> {
  await notifee.displayNotification({
    id: alert.id,
    title: alert.title,
    body: alert.body,
    data: buildSosTrayData(alert),
    ...(Platform.OS === 'android'
      ? {
          android: {
            smallIcon: 'notification_icon',
            channelId: SOS_ALERT_CHANNEL_ID,
            category: AndroidCategory.ALARM,
            importance: AndroidImportance.HIGH,
            visibility: AndroidVisibility.PUBLIC,
            pressAction: { id: ACTION_DEFAULT },
            actions: ANDROID_SOS_ACTIONS,
            ongoing: true,
            autoCancel: false,
            loopSound: true,
            sound: SOS_ALERT_NOTIFICATION_SOUND_ID,
            vibrationPattern: [300, 500, 300, 500],
            timestamp: alert.receivedAt,
            showTimestamp: true,
            style: {
              type: AndroidStyle.BIGTEXT,
              text: alert.body,
            },
          },
        }
      : {}),
    ...(Platform.OS === 'ios'
      ? {
          ios: {
            categoryId: SOS_ALERT_CATEGORY_ID,
            threadId: alert.id,
            sound: SOS_ALERT_NOTIFICATION_SOUND_IOS,
            interruptionLevel: 'timeSensitive' as const,
            // Notify Kit's native defaults are not applied when this object is
            // absent. Be explicit so the foreground JS fallback is visible.
            foregroundPresentationOptions: {
              banner: true,
              list: true,
              badge: true,
              // The visible modal owns foreground siren playback.
              sound: false,
            },
          },
        }
      : {}),
  });
}

/**
 * Transfer sound ownership from Android's ongoing notification to the in-app
 * modal without removing the notification. Re-posting the same id replaces
 * FLAG_INSISTENT, while onlyAlertOnce prevents the update from alerting again.
 */
export async function silenceDisplayedSosNotification(notification: Notification): Promise<void> {
  if (Platform.OS !== 'android' || !notification.id || !notification.android) return;

  try {
    await notifee.displayNotification({
      ...notification,
      android: {
        ...notification.android,
        smallIcon: 'notification_icon',
        loopSound: false,
        onlyAlertOnce: true,
      },
    });
  } catch {
    // Handoff failed; in-app modal still owns foreground playback.
  }
}

async function cancelDisplayedAndroidSosBeforeFreshAlert(alert: SosAlert): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    const displayed = await notifee.getDisplayedNotifications();
    const ids = displayed
      .filter(item => isSameVisibleSosAlert(item, alert))
      .map(item => item.id ?? item.notification?.id)
      .filter((id): id is string => Boolean(id));

    await Promise.all(
      [...new Set([alert.id, ...ids])].map(id => notifee.cancelNotification(id).catch(() => {})),
    );

    return ids.length > 0;
  } catch {
    return false;
  }
}

export async function presentSosNotification(
  alert: SosAlert,
  options: PresentSosNotificationOptions = {},
): Promise<void> {
  const generation = getAuthSessionGeneration();
  const operation = getAuthOperation();
  const canContinue = (): boolean => isAdmittedSosScope(alert, generation, operation);

  if (!canContinue()) return;
  await ensureNotificationSetup();
  if (!canContinue()) return;

  // This intentionally runs for every Android SOS. General setup is cached
  // per process, but the OS channel can disappear independently of app data.
  await ensureSosAndroidChannel();
  if (!canContinue()) return;

  const cancelledExisting = await cancelDisplayedAndroidSosBeforeFreshAlert(alert);
  if (!canContinue()) return;
  if (options.waitForAndroidAutoDisplay && !cancelledExisting) {
    await delay(200);
    if (!canContinue()) return;
    await cancelDisplayedAndroidSosBeforeFreshAlert(alert);
    if (!canContinue()) return;
  }

  await displaySosNotification(alert);
  if (!canContinue()) {
    await notifee.cancelNotification(alert.id).catch(() => {});
    return;
  }

  let displayedInTray = await isSosNotificationVisible(alert);
  if (!canContinue()) return;
  if (!displayedInTray) {
    await ensureSosAndroidChannel();
    if (!canContinue()) return;
    await displaySosNotification(alert);
    if (!canContinue()) {
      await notifee.cancelNotification(alert.id).catch(() => {});
      return;
    }

    displayedInTray = await isSosNotificationVisible(alert);
    if (!canContinue()) return;
    if (!displayedInTray) {
      if (Platform.OS === 'android') {
        const channel = await notifee.getChannel(SOS_ALERT_CHANNEL_ID);
        throw new Error(
          `Android did not retain SOS notification; channelExists=${Boolean(channel)}; channelBlocked=${channel?.blocked ?? false}`,
        );
      }
      throw new Error('iOS did not retain SOS notification after display retry');
    }
  }
}
