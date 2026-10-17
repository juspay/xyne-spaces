import { useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { logger } from '@/src/utils/logger';
import {
  recordAppForeground,
  recordAppBackground,
  recordActivityHeartbeat,
  recordSessionDuration,
  forceFlushMetrics,
} from '@/src/services/metrics';

/**
 * Heartbeat interval for active user tracking (60 seconds)
 */
const ACTIVITY_HEARTBEAT_INTERVAL_MS = 60000;

/**
 * Tracks app foreground/background transitions for activity monitoring.
 * Records metrics for:
 * - App lifecycle transitions (foreground/background)
 * - User activity heartbeats (for active user counting)
 * - Session duration
 *
 * Uses OpenTelemetry metrics following the apps/legacy pattern
 */
export function useAppActivityTracking(): void {
  const appState = useRef(AppState.currentState);
  const sessionStartTime = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startHeartbeat = useCallback((): void => {
    recordActivityHeartbeat();
    heartbeatIntervalRef.current = setInterval(
      () => recordActivityHeartbeat(),
      ACTIVITY_HEARTBEAT_INTERVAL_MS,
    );
    sessionStartTime.current = Date.now();
  }, []);

  const stopHeartbeat = useCallback((): void => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (sessionStartTime.current) {
      recordSessionDuration(Date.now() - sessionStartTime.current);
      sessionStartTime.current = null;
    }
  }, []);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus): void => {
      const prevState = appState.current;

      if (prevState.match(/inactive|background/) && nextState === 'active') {
        recordAppForeground();
        startHeartbeat();
      }

      if (prevState === 'active' && nextState.match(/inactive|background/)) {
        recordAppBackground();
        stopHeartbeat();
        void logger.flushLogs();
        void forceFlushMetrics();
      }

      appState.current = nextState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    if (appState.current === 'active') {
      startHeartbeat();
    }

    return () => {
      subscription.remove();
      stopHeartbeat();
      void logger.flushLogs();
      void forceFlushMetrics();
    };
  }, [startHeartbeat, stopHeartbeat]);
}
