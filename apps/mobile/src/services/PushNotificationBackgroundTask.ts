import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { callKitService } from './CallKitService';
import { parseCallDismissPayload, parseIncomingCallPayload } from './PushNotificationPayload';
import crashlytics from '@react-native-firebase/crashlytics';

const BACKGROUND_NOTIFICATION_TASK = 'LOTUS_BACKGROUND_NOTIFICATION_TASK';

interface BackgroundNotificationTaskPayload {
  notification?: Notifications.Notification;
  data?: Record<string, unknown>;
}

const reportBackgroundTaskError = (e: unknown, context: string): void => {
  try {
    const err = e instanceof Error ? e : new Error(String(e));
    crashlytics().log(context);
    crashlytics().recordError(err, context);
  } catch (reportErr) {
    console.warn('[Crashlytics] failed to record bg task error:', reportErr);
  }
};

function extractBackgroundNotificationData(
  payload: BackgroundNotificationTaskPayload,
): Record<string, unknown> | null {
  if ('notification' in payload) {
    const notification = payload.notification;
    if (!notification || typeof notification !== 'object' || !('request' in notification)) {
      return null;
    }

    const expoNotification = notification as Notifications.Notification;
    const data = expoNotification.request.content.data;
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  }

  const dataContainer = payload.data;
  if (!dataContainer || typeof dataContainer !== 'object') {
    return null;
  }

  const rawDataString = (dataContainer as Record<string, unknown>)['dataString'];
  if (typeof rawDataString === 'string' && rawDataString.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawDataString);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore malformed headless payload
    }
  }

  return dataContainer as Record<string, unknown>;
}

if (!TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
  TaskManager.defineTask<BackgroundNotificationTaskPayload>(
    BACKGROUND_NOTIFICATION_TASK,
    async ({ data, error }: TaskManager.TaskManagerTaskBody<BackgroundNotificationTaskPayload>) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.warn('[Push][BG] Notification task failed', error);
        reportBackgroundTaskError(error, 'background_notification_task');
        return;
      }

      try {
        if (!data) {
          return;
        }

        const notificationData = extractBackgroundNotificationData(data);
        if (!notificationData) {
          return;
        }

        const dismissPayload = parseCallDismissPayload(notificationData);
        if (dismissPayload) {
          if (Platform.OS === 'ios') {
            // Use reportCallEnded for remote dismissals — avoids CXEndCallAction loop.
            const callId = dismissPayload.callId;
            const uuid = callId
              ? (callKitService.getCallUUIDByCallId(callId) ?? callId)
              : callKitService.getActiveCallUUID();
            if (uuid) callKitService.reportCallEnded(uuid, 'ANSWERED_ELSEWHERE');
          } else {
            callKitService.endCall(dismissPayload.callId);
          }
          return;
        }

        const incomingCallPayload = parseIncomingCallPayload(notificationData);
        if (!incomingCallPayload) {
          return;
        }

        await callKitService.displayIncomingCall(incomingCallPayload);
      } catch (e) {
        console.error('[Push][BG] Background task error:', e);
        reportBackgroundTaskError(e, 'expo_bg_notification_task');
      }
    },
  );
}

export async function ensureBackgroundNotificationTaskRegistered(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_NOTIFICATION_TASK);
  if (isRegistered) {
    return;
  }

  await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
  // eslint-disable-next-line no-console
  console.log('[Push][BG] Background notification task registered');
}
