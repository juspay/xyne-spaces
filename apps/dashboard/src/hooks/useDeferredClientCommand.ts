import { useCallback, useEffect, useRef } from 'react';
import { getPendingMutationCount, subscribePendingMutations } from '@xyne/shared/hooks';
import { applyDynamicHeaders, performHardReload } from '../services/clients/dynamicHeaders';
import { showSwitchOverlay } from '../stores/switchOverlayStore';

export type ClientCommandEvent = 'header_update' | 'reload';

export interface ClientCommand {
  event: ClientCommandEvent;
  payload?: Record<string, unknown>;
  force?: boolean;
  loadingSeconds?: number;
}

interface PendingCommand {
  event: ClientCommandEvent;
  payload: Record<string, unknown>;
  loadingSeconds: number;
}

export function useDeferredClientCommand(): (command: ClientCommand) => void {
  const pendingRef = useRef<PendingCommand | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const stopWaiting = useCallback((): void => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  useEffect(() => stopWaiting, [stopWaiting]);

  const apply = useCallback((pending: PendingCommand): void => {
    showSwitchOverlay(pending.loadingSeconds * 1000);
    if (pending.event === 'reload') {
      void performHardReload();
      return;
    }
    const headers = pending.payload['headers'] as Record<string, string> | undefined;
    void applyDynamicHeaders(headers ?? {});
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
    (command: ClientCommand): void => {
      const pending: PendingCommand = {
        event: command.event,
        payload: command.payload ?? {},
        loadingSeconds: command.loadingSeconds ?? 0,
      };

      if (command.force) {
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
