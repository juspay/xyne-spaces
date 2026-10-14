import { useEffect } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';

import { notificationService } from './NotificationService';

type UseNotificationSessionOptions = {
  enabled: boolean;
};

/**
 * Wires the notification service lifecycle to auth state:
 *   - signed in  → start() the boot sequence
 *   - signed out → stop() and clean up listeners
 * Mount this once near the root of the protected app tree.
 */
export function useNotificationSession(options: UseNotificationSessionOptions): void {
  const { enabled } = options;
  const { isSignedIn, token } = useAuth();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (!isSignedIn || !token) {
      notificationService.stop();
      return;
    }

    void notificationService.start(token).catch(() => {});

    return () => {
      notificationService.stop();
    };
  }, [enabled, isSignedIn, token]);
}
