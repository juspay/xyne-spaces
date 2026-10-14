import { useEffect } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';
import {
  setNotificationV2CallAuthToken,
  startNotificationV2CallSetup,
  stopNotificationV2CallSetup,
} from '@/src/notifications';

import {
  registerCallForegroundMessaging,
  unregisterCallForegroundMessaging,
} from './registerCallForegroundMessaging';

/**
 * Call-only notification session — runs alongside v3, not inside it.
 *
 * Wires:
 * - CallKit accept/decline → joinCall / declineCall
 * - iOS VoIP token → backend
 * - Foreground FCM CALL_DISMISS / INCOMING_CALL
 * - Android notification accept/decline via CallNotificationDataModule
 * - LiveKit ↔ CallKit disconnect bridge (iOS)
 *
 * Does NOT start NotificationV2Service (chat path — that's v3).
 */
export function useCallNotificationSession(): void {
  const { isSignedIn, token } = useAuth();

  useEffect(() => {
    if (!isSignedIn || !token) {
      unregisterCallForegroundMessaging();
      stopNotificationV2CallSetup();
      setNotificationV2CallAuthToken(null);
      return;
    }

    let cancelled = false;

    const start = async () => {
      setNotificationV2CallAuthToken(token);

      try {
        await startNotificationV2CallSetup(token);
      } catch (error) {
        console.error('[CallNotification] startNotificationV2CallSetup failed', error);
      }

      if (cancelled) return;

      registerCallForegroundMessaging();
    };

    void start();

    return () => {
      cancelled = true;
      unregisterCallForegroundMessaging();
      stopNotificationV2CallSetup();
      setNotificationV2CallAuthToken(null);
    };
  }, [isSignedIn, token]);
}
