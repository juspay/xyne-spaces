import { useSegments, useGlobalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Event, logger } from '@/src/utils/logger';
import { crashReporter } from '@/src/utils/crashReporter';
import { recordScreenView, recordScreenDwell, MIN_DWELL_TIME_MS } from '@/src/services/metrics';

type ExitReason = 'navigation' | 'background' | 'unmount';

/**
 * Emits:
 *   - lotus_screen_dwell_time_ms   (Histogram)  → p50/p95/p99
 *   - lotus_screen_total_time_ms   (Counter)    → cumulative total
 *   - lotus_screen_view_total      (Counter)    → view count (finally wired up)
 *   - LOTUS_SCREEN_ENTER / LOTUS_SCREEN_EXIT   → log events
 */
export function useScreenDwellTracker(): void {
  const segments = useSegments();
  const searchParams = useGlobalSearchParams();
  const segmentsRef = useRef(segments);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  const currentScreenRef = useRef<string | null>(null);
  const enterTimeRef = useRef<number | null>(null);
  const isActiveRef = useRef(false);
  const isAppActiveRef = useRef(AppState.currentState === 'active');

  /**
   * Flush the current screen's dwell time.
   */
  const flush = useCallback((exitReason: ExitReason) => {
    if (!isActiveRef.current || enterTimeRef.current === null || !currentScreenRef.current) {
      return;
    }

    const dwellMs = Date.now() - enterTimeRef.current;
    const screen = currentScreenRef.current;
    const pageViewId = logger.getPageViewId();

    isActiveRef.current = false;
    enterTimeRef.current = null;

    logger.info(Event.LOTUS_SCREEN_EXIT, {
      pageUrl: screen,
      pageViewId,
      dwellMs,
      exitReason,
    });

    if (dwellMs < MIN_DWELL_TIME_MS) {
      return;
    }

    recordScreenDwell(screen, dwellMs, exitReason);
  }, []);

  /**
   * Start tracking a new screen.
   * Skips if already tracking the same screen.
   */
  const start = useCallback(
    (screen: string) => {
      if (!screen) return;
      if (isActiveRef.current && currentScreenRef.current === screen) return;

      currentScreenRef.current = screen;
      enterTimeRef.current = Date.now();
      isActiveRef.current = true;

      logger.setScreen(screen);
      crashReporter.setScreen(screen);
      logger.addBreadcrumb('navigation', `Screen: ${screen}`);

      const fromScreen =
        typeof searchParams['from'] === 'string' ? searchParams['from'] : undefined;
      logger.info(Event.LOTUS_SCREEN_ENTER, {
        pageUrl: screen,
        pageViewId: logger.getPageViewId(),
        ...(fromScreen !== undefined && { fromScreen }),
      });
      recordScreenView(screen, fromScreen);
    },
    [searchParams],
  );

  // ---------------------------------------------------------------------------
  // Navigation changes (only while app is in foreground)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const screen = segments.join('/');

    if (!isAppActiveRef.current) return;

    if (currentScreenRef.current) {
      flush('navigation');
    }

    if (screen) {
      start(screen);
    }
  }, [segments, flush, start]);

  // ---------------------------------------------------------------------------
  // App background / foreground
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const wasActive = isAppActiveRef.current;
      const isNowActive = nextState === 'active';

      if (!wasActive && isNowActive) {
        // Foreground — resume tracking current screen
        const screen = segmentsRef.current.join('/');
        if (screen) {
          start(screen);
        }
      } else if (wasActive && !isNowActive) {
        // Background or inactive — flush current screen
        flush('background');
      }

      isAppActiveRef.current = isNowActive;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [flush, start]);
  // segments deliberately excluded — read via segmentsRef to avoid listener churn

  // ---------------------------------------------------------------------------
  // Unmount safety net (hot reload, fatal error, etc.)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      flush('unmount');
    };
  }, [flush]);
}
