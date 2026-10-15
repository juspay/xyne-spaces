/**
 * Activity Metrics for Lotus
 * Tracks user activity, app lifecycle, and session metrics
 *
 * Uses OpenTelemetry SDK with lazy-initialized counters
 * Follows the same pattern as apps/legacy/src/services/metrics/enrollmentMetrics.ts
 */

import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api';
import { normalizeScreenName } from './screenMetrics';

/**
 * Get the meter instance for creating metrics
 */
function getActivityMeter(): Meter {
  return metrics.getMeter('lotus-activity');
}

// Lazy-initialized instruments to avoid NoopMeter trap
// Must not call createCounter/createHistogram at module-load time

let appLifecycleCounter: Counter | null = null;
let activityHeartbeatCounter: Counter | null = null;
let sessionDurationHistogram: Histogram | null = null;
let screenViewCounter: Counter | null = null;
let userLoginCounter: Counter | null = null;
let userLogoutCounter: Counter | null = null;

/**
 * Get or create app lifecycle counter (lazy init)
 */
function getAppLifecycleCounter(): Counter {
  if (!appLifecycleCounter) {
    appLifecycleCounter = getActivityMeter().createCounter('lotus_app_lifecycle_transition_total', {
      description: 'Total number of app lifecycle transitions (foreground/background)',
      unit: '1',
    });
  }
  return appLifecycleCounter;
}

/**
 * Get or create activity heartbeat counter
 */
function getActivityHeartbeatCounter(): Counter {
  if (!activityHeartbeatCounter) {
    activityHeartbeatCounter = getActivityMeter().createCounter(
      'lotus_user_activity_heartbeat_total',
      {
        description: 'Total number of user activity heartbeats (indicates active users)',
        unit: '1',
      },
    );
  }
  return activityHeartbeatCounter;
}

/**
 * Get or create session duration histogram
 */
function getSessionDurationHistogram(): Histogram {
  if (!sessionDurationHistogram) {
    sessionDurationHistogram = getActivityMeter().createHistogram('lotus_session_duration_ms', {
      description: 'Session duration in milliseconds',
      unit: 'ms',
    });
  }
  return sessionDurationHistogram;
}

/**
 * Get or create screen view counter
 */
function getScreenViewCounter(): Counter {
  if (!screenViewCounter) {
    screenViewCounter = getActivityMeter().createCounter('lotus_screen_view_total', {
      description: 'Total number of screen views',
      unit: '1',
    });
  }
  return screenViewCounter;
}

/**
 * Get or create user login counter (lazy init)
 */
function getUserLoginCounter(): Counter {
  if (!userLoginCounter) {
    userLoginCounter = getActivityMeter().createCounter('lotus_user_login_total', {
      description: 'Total number of user logins',
      unit: '1',
    });
  }
  return userLoginCounter;
}

/**
 * Get or create user logout counter (lazy init)
 */
function getUserLogoutCounter(): Counter {
  if (!userLogoutCounter) {
    userLogoutCounter = getActivityMeter().createCounter('lotus_user_logout_total', {
      description: 'Total number of user logouts',
      unit: '1',
    });
  }
  return userLogoutCounter;
}

// ==============================================================================
// Convenience functions for recording metrics with common attributes
// ==============================================================================

/**
 * Record app foreground transition
 */
export function recordAppForeground(): void {
  getAppLifecycleCounter().add(1, {
    transition: 'foreground',
    platform: Platform.OS,
    build_version: DeviceInfo.getVersion(),
    build_type: __DEV__ ? 'debug' : 'release',
  });
}

/**
 * Record app background transition
 */
export function recordAppBackground(): void {
  getAppLifecycleCounter().add(1, {
    transition: 'background',
    platform: Platform.OS,
    build_version: DeviceInfo.getVersion(),
    build_type: __DEV__ ? 'debug' : 'release',
  });
}

/**
 * Record user activity heartbeat
 * Called periodically while app is in foreground
 */
export function recordActivityHeartbeat(): void {
  try {
    getActivityHeartbeatCounter().add(1, {
      platform: Platform.OS,
      build_version: DeviceInfo.getVersion(),
      build_type: __DEV__ ? 'debug' : 'release',
    });
  } catch {
    // Silently ignore metric recording errors
  }
}

/**
 * Record active session duration
 * Called when app goes to background
 */
export function recordSessionDuration(durationMs: number): void {
  getSessionDurationHistogram().record(durationMs, {
    platform: Platform.OS,
    build_type: __DEV__ ? 'debug' : 'release',
  });
}

/**
 * Record screen view
 * Uses normalizeScreenName to ensure label consistency with recordScreenDwell
 */
export function recordScreenView(screenName: string, fromScreen?: string): void {
  const attributes = {
    platform: Platform.OS,
    screen: normalizeScreenName(screenName),
    build_type: __DEV__ ? 'debug' : 'release', // Filter test devices
    ...(fromScreen ? { from_screen: normalizeScreenName(fromScreen) } : {}),
  };

  getScreenViewCounter().add(1, attributes);

  if (__DEV__) {
    console.log('[Metrics] Recorded screen view:', attributes);
  }
}

/**
 * Record user login
 */
export function recordUserLogin(method: 'google' | 'other'): void {
  getUserLoginCounter().add(1, {
    platform: Platform.OS,
    method,
    build_type: __DEV__ ? 'debug' : 'release',
  });
}

/**
 * Record user logout
 */
export function recordUserLogout(): void {
  getUserLogoutCounter().add(1, {
    platform: Platform.OS,
    build_type: __DEV__ ? 'debug' : 'release',
  });
}
