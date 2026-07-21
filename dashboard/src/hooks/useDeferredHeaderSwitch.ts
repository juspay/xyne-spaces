import { useCallback, useEffect, useRef } from 'react';
import { getPendingMutationCount, subscribePendingMutations } from '@xyne/shared/hooks';
import { applyDynamicHeaders } from '../services/clients/dynamicHeaders';
import { showSwitchOverlay } from '../stores/switchOverlayStore';

export interface HeaderSwitchPayload {
  headers?: Record<string, string>;
  force?: boolean;
  loadingSeconds?: number;
}

interface PendingSwitch {
  headers: Record<string, string>;
  loadingSeconds: number;
}

export function useDeferredHeaderSwitch(): (payload: HeaderSwitchPayload) => void {
  const pendingRef = useRef<PendingSwitch | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const stopWaiting = useCallback((): void => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  useEffect(() => stopWaiting, [stopWaiting]);

  const apply = useCallback((pending: PendingSwitch): void => {
    showSwitchOverlay(pending.loadingSeconds * 1000);
    void applyDynamicHeaders(pending.headers);
  }, []);

  const tryApply = useCallback((): void => {
    const pending = pendingRef.current;
    if (pending && getPendingMutationCount() === 0) {
      pendingRef.current = null;
      stopWaiting();
      apply(pending);
    }
  }, [apply, stopWaiting]);

  return useCallback(
    (payload: HeaderSwitchPayload): void => {
      const pending: PendingSwitch = {
        headers: payload?.headers ?? {},
        loadingSeconds: payload?.loadingSeconds ?? 0,
      };

      if (payload?.force) {
        pendingRef.current = null;
        stopWaiting();
        apply(pending);
        return;
      }

      pendingRef.current = pending;
      stopWaiting();
      unsubscribeRef.current = subscribePendingMutations(() => tryApply());
      tryApply();
    },
    [apply, stopWaiting, tryApply],
  );
}
