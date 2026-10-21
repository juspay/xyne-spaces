import notifee, { AuthorizationStatus } from 'react-native-notify-kit';
import { Platform } from 'react-native';

const PERMISSION_TIMEOUT_MS = 12000;

function isGranted(status: number): boolean {
  return status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), ms)),
  ]);
}

async function readCurrentStatus(): Promise<number | null> {
  try {
    const getSettings = (
      notifee as unknown as {
        getNotificationSettings?: () => Promise<{ authorizationStatus: number }>;
      }
    ).getNotificationSettings;

    if (typeof getSettings !== 'function') return null;
    const settings = await getSettings();
    return settings.authorizationStatus;
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const current = await readCurrentStatus();
    if (current !== null && isGranted(current)) {
      return true;
    }

    const requestResult = await withTimeout(notifee.requestPermission(), PERMISSION_TIMEOUT_MS);

    if (requestResult !== 'timeout') {
      return isGranted(requestResult.authorizationStatus);
    }

    const fallback = await readCurrentStatus();
    if (fallback !== null) {
      return isGranted(fallback);
    }

    // Android-safe fallback: even when UI prompt path is flaky, token registration
    // should proceed to avoid first-login no-notification complaints.
    if (Platform.OS === 'android') {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
