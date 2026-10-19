import * as Notifications from 'expo-notifications';
import notifee from 'react-native-notify-kit';

import CallNotificationDataModule from '@/src/modules/CallNotificationDataModule';
import { deleteKeys, getAllKeys } from '@/src/services/localStorage';
import { callKitService } from '@/src/services/CallKitService';
import {
  clearPendingCallActionForSession,
  getCallLaunchLifecycleGeneration,
} from '@/src/services/callLaunchLifecycle';

import { clearNotificationNavigationState } from './tapNavigation';
import { notificationService } from './NotificationService';
import { getUserNotificationStorageKeys } from './notificationStorageKeys';
import { resetSosAlerts } from './sos/store';

const NOTIFICATION_NATIVE_CLEANUP_TIMEOUT_MS = 2_000;

async function boundedNativeCleanup(start: () => Promise<void>): Promise<void> {
  let operation: Promise<void>;
  try {
    operation = start();
  } catch {
    return;
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>(resolve => {
    timeoutHandle = setTimeout(resolve, NOTIFICATION_NATIVE_CLEANUP_TIMEOUT_MS);
  });
  await Promise.race([operation.catch(() => undefined), timeout]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
}

/**
 * Stop notification producers before credentials are removed and clear both
 * displayed/scheduled notifications and the JS/native handoff state. Each
 * native operation is best effort; local auth cleanup must continue offline or
 * when a notification module is unavailable during startup.
 */
export async function clearNotificationSessionArtifacts(): Promise<void> {
  notificationService.stop();
  clearNotificationNavigationState();
  resetSosAlerts();
  const callLaunchGeneration = getCallLaunchLifecycleGeneration();

  const userScopedKeys = getUserNotificationStorageKeys(getAllKeys());
  if (userScopedKeys.length > 0) {
    deleteKeys(userScopedKeys);
  }

  await Promise.allSettled([
    boundedNativeCleanup(() => notifee.cancelAllNotifications()),
    boundedNativeCleanup(() => Notifications.dismissAllNotificationsAsync()),
    boundedNativeCleanup(() => Notifications.cancelAllScheduledNotificationsAsync()),
    boundedNativeCleanup(() => CallNotificationDataModule.clearCallData()),
    boundedNativeCleanup(() => callKitService.clearPendingNativeState()),
    boundedNativeCleanup(() => clearPendingCallActionForSession(callLaunchGeneration)),
  ]);
}
