/**
 * App Startup Performance Metrics
 * Histograms percentiles (p50, p95, p99) in VictoriaMetrics.
 */

import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api';
import { logger, Event } from '@/src/utils/logger';

// Cache static device attributes once at module init
const APP_VERSION = DeviceInfo.getVersion();
const OS_VERSION = DeviceInfo.getSystemVersion();

/**
 * Get the meter instance for creating startup metrics
 */
function getStartupMeter(): Meter {
  return metrics.getMeter('lotus-startup');
}

// Lazy-initialized instruments to avoid NoopMeter trap
let startupSplashDismissHistogram: Histogram | null = null;
let startupPhaseHistogram: Histogram | null = null;
let startupEventCounter: Counter | null = null;

/**
 * Get or create splash dismiss histogram (lazy init)
 *
 * Tracks user-perceived startup time: native launch to splash screen dismiss.
 * This is the sole total startup metric.
 */
function getStartupSplashDismissHistogram(): Histogram {
  if (!startupSplashDismissHistogram) {
    startupSplashDismissHistogram = getStartupMeter().createHistogram(
      'lotus_startup_splash_dismiss_ms_v3',
      {
        description: 'User-perceived startup time from native launch to splash dismiss',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [
            100,
            250,
            500,
            750,
            1000, // Sub-second
            1500,
            2000,
            3000,
            5000, // Fast: 1-5s
            7500,
            10000,
            15000,
            20000, // Slow: 5-20s
            30000,
            45000,
            60000, // Very slow: 30-60s
          ],
        },
      },
    );
  }
  return startupSplashDismissHistogram;
}

/**
 * Get or create startup phase histogram (lazy init)
 *
 * Tracks individual phase durations with 'phase' attribute for breakdown analysis.
 * Focuses on key bottleneck phases only to keep cardinality low.
 */
function getStartupPhaseHistogram(): Histogram {
  if (!startupPhaseHistogram) {
    startupPhaseHistogram = getStartupMeter().createHistogram('lotus_startup_phase_ms_v3', {
      description: 'Startup phase durations for bottleneck analysis',
      unit: 'ms',
      // Explicit buckets for phase timing (phases range from 100ms to 20s)
      advice: {
        explicitBucketBoundaries: [
          50,
          100,
          250,
          500,
          1000, // Sub-second phases
          2000,
          5000,
          10000,
          15000,
          20000, // Multi-second phases
        ],
      },
    });
  }
  return startupPhaseHistogram;
}

/**
 * Type for startup timing payload (matches startupTimings.ts)
 */
type StartupTimingsPayload = {
  coldStart: boolean;
  native_anchor: 'activity' | 'app' | 'process';
  final_reason?: 'complete' | 'fallback_after_splash' | 'watchdog';
  durations_ms: Record<string, number>;
  spans_ms?: Record<string, number>;
  screen: string;
  initial_route_segments?: string[];
  isEnrolled: boolean | null;
  isLoggedIn: boolean | null;
};

/**
 * Sole total startup metric source key.
 * User-perceived startup: native launch to splash screen dismiss.
 */
const TOTAL_STARTUP_KEY = 'splash_hidden' as const;

const DASHBOARD_PHASES = [
  'native_to_airborne_start_app_ms',
  'airborne_init_ms',
  'enrollment_check_ms',
  'auth_loading_ms',
  'root_navigation_state_to_splash_hidden_ms',
  'query_cache_setup_ms',
  'zero_users_load_ms',
  'zero_channels_load_ms',
  'zero_visible_channels_ms',
  'query_cache_hydration_ms',
] as const;

/** Max reasonable startup duration (ms). Values above this are measurement errors (e.g. background-launch contamination). */
const MAX_VALID_STARTUP_MS = 60000;

function getValidDuration(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_VALID_STARTUP_MS
    ? value
    : undefined;
}

let startupInvalidDurationCounter: Counter | null = null;

function getStartupInvalidDurationCounter(): Counter {
  if (!startupInvalidDurationCounter) {
    startupInvalidDurationCounter = getStartupMeter().createCounter(
      'lotus_startup_invalid_duration_total_v3',
      {
        description: 'Invalid startup duration values dropped from histograms',
        unit: '1',
      },
    );
  }
  return startupInvalidDurationCounter;
}

/**
 * Get or create startup event counter (for debugging histogram export issues)
 */
function getStartupEventCounter(): Counter {
  if (!startupEventCounter) {
    startupEventCounter = getStartupMeter().createCounter('lotus_startup_event_total_v3', {
      description: 'Total number of startup events (diagnostic counter)',
      unit: '1',
    });
  }
  return startupEventCounter;
}

/**
 * Record startup metrics to OpenTelemetry
 *
 * Called from startupTimings.markDmRowsFirstNonEmpty() after calculating all durations.
 * Records metrics in a non-blocking way - failures won't crash the app.
 *
 * @param payload Startup timing payload with all durations and metadata
 */
export function recordStartupMetrics(payload: StartupTimingsPayload): void {
  try {
    // Base attributes for all metrics
    const baseAttributes = {
      platform: Platform.OS as 'android' | 'ios',
      app_version: APP_VERSION,
      os_version: OS_VERSION,
      build_type: __DEV__ ? 'debug' : 'release',
      native_anchor: payload.native_anchor,
      final_reason: payload.final_reason ?? 'unknown',
      is_enrolled: payload.isEnrolled === null ? 'unknown' : String(payload.isEnrolled),
      is_logged_in: payload.isLoggedIn === null ? 'unknown' : String(payload.isLoggedIn),
      cold_start: String(payload.coldStart),
    };

    console.log('[StartupMetrics] Recording startup metrics:', {
      screen: payload.screen,
      final_reason: payload.final_reason,
      cold_start: payload.coldStart,
      splash_hidden_ms: payload.durations_ms[TOTAL_STARTUP_KEY],
      span_keys: payload.spans_ms ? Object.keys(payload.spans_ms) : [],
      duration_keys: Object.keys(payload.durations_ms),
    });

    // Record a counter for each startup event
    getStartupEventCounter().add(1, baseAttributes);

    // Record total startup time (user-perceived: native launch to splash dismiss)
    const totalTime = getValidDuration(payload.durations_ms[TOTAL_STARTUP_KEY]);
    if (totalTime !== undefined) {
      getStartupSplashDismissHistogram().record(totalTime, baseAttributes);
      console.log(`[StartupMetrics] Recorded splash dismiss: ${totalTime}ms`);
    } else if (payload.durations_ms[TOTAL_STARTUP_KEY] !== undefined) {
      logger.error(Event.LOTUS_STARTUP_DIAGNOSTIC, {
        reason: 'startup_invalid_total_duration',
        totalKey: TOTAL_STARTUP_KEY,
        totalTime: payload.durations_ms[TOTAL_STARTUP_KEY],
        maxAllowed: MAX_VALID_STARTUP_MS,
      });
      getStartupInvalidDurationCounter().add(1);
      console.warn(
        '[StartupMetrics] Skipped splash dismiss — invalid duration:',
        payload.durations_ms[TOTAL_STARTUP_KEY],
      );
    } else {
      console.warn('[StartupMetrics] Skipped splash dismiss — missing duration');
    }

    // Record all available phases from spans_ms (query cache, startup queries, etc.)
    const phasesRecordedFromSpans = new Set<string>();
    if (payload.spans_ms) {
      for (const [phaseName, duration] of Object.entries(payload.spans_ms)) {
        phasesRecordedFromSpans.add(phaseName);
        const validDuration = getValidDuration(duration);
        if (validDuration !== undefined) {
          getStartupPhaseHistogram().record(validDuration, {
            ...baseAttributes,
            phase: phaseName,
          });
        } else if (duration !== undefined && typeof duration === 'number') {
          logger.warn(Event.LOTUS_STARTUP_DIAGNOSTIC, {
            reason: 'startup_phase_invalid_duration_spans',
            phase: phaseName,
            duration,
            reasonDetail: !Number.isFinite(duration)
              ? 'non_finite'
              : duration < 0
                ? 'negative'
                : 'exceeds_max',
          });
        }
      }
    }

    // Record dashboard-expected phases from durations_ms if not already emitted via spans_ms
    for (const phaseName of DASHBOARD_PHASES) {
      if (phasesRecordedFromSpans.has(phaseName)) {
        continue;
      }
      const duration = payload.durations_ms[phaseName];
      if (duration !== undefined) {
        const validDuration = getValidDuration(duration);
        if (validDuration !== undefined) {
          getStartupPhaseHistogram().record(validDuration, {
            ...baseAttributes,
            phase: phaseName,
          });
        } else if (typeof duration === 'number') {
          // Log but don't count as error - these are measurement issues
          logger.debug(Event.LOTUS_STARTUP_DIAGNOSTIC, {
            reason: 'startup_phase_invalid_duration_durations',
            phase: phaseName,
            duration,
            reasonDetail: !Number.isFinite(duration)
              ? 'non_finite'
              : duration < 0
                ? 'negative'
                : 'exceeds_max',
          });
        }
      }
    }

    console.log('[StartupMetrics] Recording complete');
  } catch (error) {
    // Metric recording failures should never crash the app
    console.error('[StartupMetrics] recordStartupMetrics failed:', error);
    logger.error(Event.LOTUS_METRIC_ERROR, {
      context: 'startup_metrics',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
