import messaging from '@react-native-firebase/messaging';

import { handleForegroundCallRemoteMessage } from '@/src/notifications';

let unsubscribe: (() => void) | null = null;

/**
 * Foreground FCM listener for call control signals only.
 * Safe to run alongside v3's messaging().onMessage — call types are ignored by v3.
 */
export function registerCallForegroundMessaging(): () => void {
  unsubscribe?.();

  const sub = messaging().onMessage(async remoteMessage => {
    try {
      await handleForegroundCallRemoteMessage(remoteMessage);
    } catch (error) {
      console.warn('[CallNotification] foreground FCM handler failed', error);
    }
  });

  unsubscribe = () => sub();
  return unsubscribe;
}

export function unregisterCallForegroundMessaging(): void {
  unsubscribe?.();
  unsubscribe = null;
}
