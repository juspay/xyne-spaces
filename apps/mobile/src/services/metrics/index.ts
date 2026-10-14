/**
 * Metrics Service for Lotus
 * Re-exports all metrics modules following the apps/legacy pattern
 */

// Core telemetry infrastructure
export {
  initializeTelemetry,
  shutdownTelemetry,
  safeRecordMetric,
  getMeter,
  forceFlushMetrics,
} from './telemetry';

// Screen dwell time metrics - Constants only
export { MIN_DWELL_TIME_MS } from './screenMetrics';

// Screen dwell convenience functions
export { recordScreenDwell, normalizeScreenName } from './screenMetrics';

// Activity/lifecycle convenience functions
export {
  recordAppForeground,
  recordAppBackground,
  recordActivityHeartbeat,
  recordSessionDuration,
  recordScreenView,
  recordUserLogin,
  recordUserLogout,
} from './activityMetrics';

// Startup performance metrics
export { recordStartupMetrics } from './startupMetrics';
