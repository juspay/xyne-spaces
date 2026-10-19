import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { Event, logger } from '@/src/utils/logger';
import { isStatusExpired } from '@/src/utils/statusUtils';

import { useClearOwnStatus } from './useClearOwnStatus';
import { useSelf } from './useUsers';

type UseClearExpiredOwnStatusOptions = {
  enabled?: boolean;
};

/**
 * Clears the signed-in user's expired custom status when the app starts or returns
 * to the foreground. UI should still use hasActiveCustomStatus / isStatusExpired at
 * render time (Slack-style lazy evaluation).
 */
export function useClearExpiredOwnStatus({
  enabled = true,
}: UseClearExpiredOwnStatusOptions = {}): void {
  const self = useSelf();
  const clearOwnStatus = useClearOwnStatus();
  const clearedForExpiryRef = useRef<number | null>(null);

  const statusExpiryAt = self?.statusExpiryAt;
  const hasStatus = Boolean(self?.statusEmoji || self?.statusContent);

  const clearExpiredStatus = useCallback((): void => {
    if (!self || !hasStatus || !statusExpiryAt || !isStatusExpired(statusExpiryAt)) return;
    if (clearedForExpiryRef.current === statusExpiryAt) return;
    clearedForExpiryRef.current = statusExpiryAt;

    try {
      clearOwnStatus();
    } catch (err) {
      logger.error(Event.ZERO_MUTATION_ERROR, {
        context: 'useClearExpiredOwnStatus',
        action: 'clear_expired_status',
        error: err,
      });
    }
  }, [self, hasStatus, statusExpiryAt, clearOwnStatus]);

  useEffect(() => {
    if (!enabled) return;
    clearExpiredStatus();
  }, [enabled, clearExpiredStatus]);

  useEffect(() => {
    if (!enabled) return;

    const onAppStateChange = (state: AppStateStatus): void => {
      if (state === 'active') {
        clearExpiredStatus();
      }
    };

    const subscription = AppState.addEventListener('change', onAppStateChange);
    return (): void => subscription.remove();
  }, [enabled, clearExpiredStatus]);
}
