import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

import type { RawPushMessage } from '../types';

// iOS shows its own banner for foreground pushes by default, which hides the
// payload from onMessage. We disable that so onMessage always fires and our
// service owns the data. (Drawing our own UI is a later step.)
export async function configureIosForegroundDelivery(): Promise<void> {
  if (Platform.OS !== 'ios') return;

  // Allow Firebase to auto-init messaging.
  await messaging().setAutoInitEnabled(true);

  // This method exists on the native module but isn't always typed; grab it safely.
  const setOptions = (
    messaging() as {
      setForegroundNotificationPresentationOptions?: (o: {
        alert: boolean;
        badge: boolean;
        sound: boolean;
      }) => Promise<void>;
    }
  ).setForegroundNotificationPresentationOptions;

  if (typeof setOptions === 'function') {
    // alert:false → no native foreground banner; we get the payload instead.
    await setOptions({ alert: false, badge: true, sound: false });
  }
}

// Subscribe to foreground messages (app open). Returns an unsubscribe function.
export function subscribeToForegroundMessages(
  onMessage: (message: RawPushMessage) => void,
): () => void {
  return messaging().onMessage(message => {
    onMessage(message);
  });
}

// Subscribe to token rotations. Firebase occasionally rotates the FCM token;
// when it does we must re-register the new one with the backend.
export function subscribeToTokenRefresh(onRefresh: (token: string) => void): () => void {
  return messaging().onTokenRefresh(token => {
    onRefresh(token);
  });
}

// Warm iOS taps on APNS banners (Notifee did not draw the tray item).
export function subscribeToNotificationOpen(onOpen: (message: RawPushMessage) => void): () => void {
  return messaging().onNotificationOpenedApp(onOpen);
}
