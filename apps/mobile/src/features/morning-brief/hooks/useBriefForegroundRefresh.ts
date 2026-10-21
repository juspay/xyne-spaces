import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { briefKeys } from './useBriefQueries';

/**
 * Refresh the brief queries when the app returns to the foreground — the
 * mobile counterpart of the web screen's `visibilitychange` reload. Scoped to
 * the screen's lifetime; react-query has no focusManager bridge in this app.
 */
export function useBriefForegroundRefresh(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let lastState: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', nextState => {
      const wasBackgrounded = lastState !== 'active';
      lastState = nextState;
      if (nextState === 'active' && wasBackgrounded) {
        void queryClient.invalidateQueries({ queryKey: briefKeys.all });
      }
    });
    return (): void => subscription.remove();
  }, [queryClient]);
}
