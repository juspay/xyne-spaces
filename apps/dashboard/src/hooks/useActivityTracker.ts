import { useCallback, useEffect, useRef } from 'react';
import { useIdleTimer } from 'react-idle-timer';
import { activityApi } from '../api/activityApi';
import { ActivityEvent, ActivityStatus, ActivityLogPayload } from '@xyne/shared';
import { useAuth } from './useAuth';
import { logger, Event as LogEvent } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { ENABLE_ACTIVITY_LOG } from '../config';

// Idle timeout
const IDLE_TIMEOUT_MS = 60_000; // 60 seconds

// Note: sessionId is managed by backend using UserSession.id from cookie

interface ActivityTrackerReturn {
  isIdle: () => boolean;
  getLastActiveTime: () => Date | null;
  getRemainingTime: () => number;
}

/**
 * Custom hook to track user activity using React Idle Timer
 * Automatically logs activity events to the backend API
 * Features:
 * - Detects when user goes idle (60s of inactivity)
 * - Logs when user returns from idle
 * - Tracks page changes via React Router pathname
 * @param currentPathname - The current pathname from React Router's useLocation()
 */
export function useActivityTracker(currentPathname?: string): ActivityTrackerReturn {
  const { user } = useAuth();
  const previousPage = useRef<string>(currentPathname || window.location.pathname);

  // Tracks when the current active period started
  const lastActiveStartTime = useRef<number | null>(null);

  // Page-level duration tracking - tracks last onAction time on current page
  const lastOnActionTime = useRef<number>(Date.now());

  /**
   * Build and send activity log payload
   */
  const logActivity = useCallback(
    (
      event: ActivityEvent,
      status: ActivityStatus,
      page: string,
      triggerEvent?: string,
      activeDurationSec?: number,
      pageDurationSec?: number,
      prevPage?: string,
    ) => {
      // Don't log if user not authenticated
      if (!user?.id) return;
      if (!ENABLE_ACTIVITY_LOG) return;

      const payload: ActivityLogPayload = {
        timestamp: new Date().toISOString(),
        userId: user.id,
        ...(user.email && { userEmail: user.email }),
        // sessionId is added by backend from UserSession.id (cookie)
        event,
        status,
        page,
        ...(activeDurationSec !== undefined && { activeDurationSec }),
        ...(pageDurationSec !== undefined && { pageDurationSec }),
        ...(prevPage && { previousPage: prevPage }),
        ...(triggerEvent && { triggerEvent }),
      };

      // Handle the promise properly instead of using void
      activityApi.logActivity(payload).catch(error => {
        // Log error but don't throw to avoid disrupting user experience
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('Activity logging failed:'),
          context: [error],
        });
      });
    },
    [user?.id, user?.email],
  );

  /**
   * Handle idle event (user inactive for 60s)
   */
  const handleIdle = useCallback(() => {
    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String('🔵 ACTIVITY_TRACE [Frontend]: handleIdle() triggered - user went idle'),
    });

    const now = Date.now();

    // Calculate duration of the active period that just ended
    let activeDurationSec = 0;
    if (lastActiveStartTime.current !== null) {
      const durationMs = now - lastActiveStartTime.current;
      activeDurationSec = Math.round(durationMs / 1000);

      // Mark active period as ended
      lastActiveStartTime.current = null;
    }

    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String('🔵 ACTIVITY_TRACE [Frontend]: Active period ended'),
      context: [
        {
          activeDurationSec,
        },
      ],
    });

    const currentPage = currentPathname || window.location.pathname;
    logActivity('onIdle', 'idle', currentPage, undefined, activeDurationSec);
  }, [logActivity, currentPathname]);

  /**
   * Handle active event (user returns from idle)
   */
  const handleActive = useCallback(
    (event?: Event) => {
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String(
          '🔵 ACTIVITY_TRACE [Frontend]: handleActive() triggered - user returned from idle',
        ),
      });

      const eventType = event?.type || 'unknown';
      const now = Date.now();

      // Start new active period
      lastActiveStartTime.current = now;

      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String('🔵 ACTIVITY_TRACE [Frontend]: New active period started'),
        context: [
          {
            pageDurationSec: 0,
            triggerEvent: eventType,
          },
        ],
      });

      const currentPage = currentPathname || window.location.pathname;
      // Log state transition
      logActivity('onActive', 'active', currentPage);
      // Log the triggering action with pageDurationSec = 0 (reset after idle)
      logActivity('onAction', 'active', currentPage, eventType, undefined, 0);
      lastOnActionTime.current = now;
    },
    [logActivity, currentPathname],
  );

  /**
   * Extract the first segment of a route path
   * e.g., "/analytics/reports" -> "/analytics"
   *       "/dashboard" -> "/dashboard"
   *       "/" -> "/"
   */
  const getFirstRouteSegment = useCallback((path: string): string => {
    if (path === '/') return '/';
    const segments = path.split('/').filter(Boolean);
    return segments.length > 0 ? `/${segments[0]}` : '/';
  }, []);

  /**
   * Handle action event from idle timer
   * NOTE: Page change detection is handled by the useEffect with React Router's pathname,
   * so we don't need to check for page changes here. This avoids duplicate logs.
   */
  const handleAction = useCallback((_event?: Event) => {
    // Page change detection is handled by the useEffect watching currentPathname
    // This callback is intentionally empty to avoid duplicate page_change logs
  }, []);

  // Initialize idle timer
  const idleTimer = useIdleTimer({
    timeout: IDLE_TIMEOUT_MS,
    disabled: !ENABLE_ACTIVITY_LOG,

    // Events to monitor
    events: ['mousemove', 'keydown', 'wheel', 'mousedown', 'touchstart', 'touchmove'],

    // Idle detection only needs coarse granularity; without throttling,
    // react-idle-timer runs its handler on EVERY mousemove/wheel event,
    // a constant CPU/battery drain.
    throttle: 500,

    // Event handlers
    onIdle: handleIdle,
    onActive: handleActive,
    onAction: handleAction,

    // Start immediately
    startOnMount: true,

    // Don't start as idle
    startManually: false,
  });

  // Track if initial mount has completed (to skip logging redirects on first load)
  const hasLoggedInitialActive = useRef(false);
  // Track if we've finished the initial settling period (to ignore initial redirects)
  const hasSettled = useRef(false);
  // Store the settled page after initial load
  const settledPage = useRef<string | null>(null);
  // Ref for the initial active timeout (so we can reset it on pathname changes)
  const initialActiveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to always have the latest pathname available
  const latestPathnameRef = useRef<string>(currentPathname || window.location.pathname);

  // Keep the latest pathname ref updated
  useEffect(() => {
    latestPathnameRef.current = currentPathname || window.location.pathname;
    const pageViewId = uuidv4();
    const pageUrl = currentPathname || window.location.pathname;
    logger.setPageView(pageViewId, pageUrl);
  }, [currentPathname]);

  // Log initial active state after routing settles (debounced)
  useEffect(() => {
    // Only run when user is authenticated and we haven't logged yet
    if (!user?.id || hasLoggedInitialActive.current) {
      return undefined;
    }

    // Clear any existing timeout (debounce - restart the timer on each pathname change)
    if (initialActiveTimeoutRef.current) {
      clearTimeout(initialActiveTimeoutRef.current);
    }

    // Use a small delay to let initial redirects settle
    initialActiveTimeoutRef.current = setTimeout(() => {
      if (hasLoggedInitialActive.current) return; // Double-check in case of race

      hasLoggedInitialActive.current = true;
      hasSettled.current = true;

      const now = Date.now();
      // Use the ref to get the LATEST pathname, not the one from when timeout was set
      const finalPage = latestPathnameRef.current;

      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String(
          '🔵 ACTIVITY_TRACE [Frontend]: Initial active state after settle (debounced)',
        ),
        context: [
          {
            page: finalPage,
          },
        ],
      });

      // Initialize tracking
      lastActiveStartTime.current = now;
      lastOnActionTime.current = now;
      previousPage.current = finalPage;
      settledPage.current = finalPage;

      logActivity('onActive', 'active', finalPage);
      initialActiveTimeoutRef.current = null;
    }, 200); // 200ms delay to let redirects complete

    return () => {
      if (initialActiveTimeoutRef.current) {
        clearTimeout(initialActiveTimeoutRef.current);
      }
    };
  }, [user?.id, logActivity, currentPathname]);

  // Ref to store pending page change timeout (for debouncing)
  const pageChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to store the original page before any navigation started
  const navigationStartPage = useRef<string | null>(null);
  // Ref to store the time when navigation started
  const navigationStartTime = useRef<number | null>(null);

  // Monitor page changes via useEffect (for React Router navigation)
  useEffect(() => {
    // Don't log until initial settling is complete
    if (!hasSettled.current) {
      return;
    }

    // Use the pathname passed from React Router, fallback to window.location
    const currentPage = currentPathname || window.location.pathname;

    // Only process if page actually changed
    if (currentPage !== previousPage.current && user?.id) {
      // If this is the start of a new navigation sequence, capture the original page
      if (navigationStartPage.current === null) {
        navigationStartPage.current = previousPage.current;
        navigationStartTime.current = Date.now();
      }

      // Clear any pending timeout (debounce)
      if (pageChangeTimeoutRef.current) {
        clearTimeout(pageChangeTimeoutRef.current);
      }

      // Update previousPage immediately to track intermediate changes
      previousPage.current = currentPage;

      // Debounce: wait 100ms before logging to let route settle
      pageChangeTimeoutRef.current = setTimeout(() => {
        const oldPage = navigationStartPage.current!;
        const oldPageFirstSegment = getFirstRouteSegment(oldPage);
        const startTime = navigationStartTime.current!;

        // Calculate time since navigation started from original page
        const pageDurationMs = startTime - lastOnActionTime.current;
        const pageDurationSec = Math.round(pageDurationMs / 1000);

        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('🔵 ACTIVITY_TRACE [Frontend]: Page changed (debounced)'),
          context: [
            {
              from: oldPage,
              to: currentPage,
              timeOnPreviousPage: pageDurationSec,
            },
          ],
        });

        // Log page change with duration since last onAction (use first segment of original page)
        logActivity(
          'onAction',
          'active',
          currentPage,
          'page_change',
          undefined,
          pageDurationSec,
          oldPageFirstSegment,
        );

        // Reset tracking for new page
        lastOnActionTime.current = Date.now();

        // Reset navigation tracking
        navigationStartPage.current = null;
        navigationStartTime.current = null;
        pageChangeTimeoutRef.current = null;
      }, 100); // 100ms debounce
    }

    // Cleanup timeout on unmount
    return () => {
      if (pageChangeTimeoutRef.current) {
        clearTimeout(pageChangeTimeoutRef.current);
      }
    };
  }, [currentPathname, user?.id, logActivity, getFirstRouteSegment]);

  // Cleanup all timeouts on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (initialActiveTimeoutRef.current) {
        clearTimeout(initialActiveTimeoutRef.current);
      }
      if (pageChangeTimeoutRef.current) {
        clearTimeout(pageChangeTimeoutRef.current);
      }
    };
  }, []);

  return {
    isIdle: (): boolean => idleTimer.isIdle(),
    getLastActiveTime: (): Date | null => idleTimer.getLastActiveTime(),
    getRemainingTime: (): number => idleTimer.getRemainingTime(),
  };
}
