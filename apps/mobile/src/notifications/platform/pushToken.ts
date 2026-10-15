import messaging from '@react-native-firebase/messaging';

import {
  APNS_TOKEN_POLL_INTERVAL_MS,
  APNS_TOKEN_TIMEOUT_MS,
  getSupportedPlatform,
} from '../config';

// Promise-based sleep, used while polling for the iOS APNs token.
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// True when the error is the known "APNs token not ready yet" race on iOS.
function isMissingApnsTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('No APNS token');
}

// iOS only: poll until the native layer hands Firebase the APNs token.
// Requires the AppDelegate to forward the device token to Firebase Messaging.
async function waitForApnsToken(): Promise<boolean> {
  const deadline = Date.now() + APNS_TOKEN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const apnsToken = await messaging().getAPNSToken();
    if (apnsToken?.trim()) {
      return true;
    }
    await sleep(APNS_TOKEN_POLL_INTERVAL_MS);
  }

  return false;
}

// Android: the FCM token is available right after install, no APNs dance.
async function resolveAndroidToken(): Promise<string | null> {
  try {
    const token = await messaging().getToken();
    return token?.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

// iOS: must register for remote messages and wait for APNs before getToken.
async function resolveIosToken(): Promise<string | null> {
  // Tells iOS we want remote pushes; this kicks off APNs registration.
  await messaging().registerDeviceForRemoteMessages();
  await waitForApnsToken();

  try {
    const token = await messaging().getToken();
    return token?.trim() ? token.trim() : null;
  } catch (error) {
    // Anything other than the APNs race is a real failure — stop.
    if (!isMissingApnsTokenError(error)) {
      return null;
    }
    // One retry: the APNs token sometimes lands a beat after registration.
    await waitForApnsToken();
    try {
      const retry = await messaging().getToken();
      return retry?.trim() ? retry.trim() : null;
    } catch {
      return null;
    }
  }
}

// Public entry: resolve the FCM token for whichever platform we're on.
export async function resolvePushToken(): Promise<string | null> {
  const platform = getSupportedPlatform();
  if (!platform) {
    return null;
  }

  return platform === 'ios' ? await resolveIosToken() : await resolveAndroidToken();
}
