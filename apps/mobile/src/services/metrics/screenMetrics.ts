// Screen Dwell Time Metrics

import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api';
import { logger, Event } from '@/src/utils/logger';

/**
 * Minimum dwell time to record (ms).
 * Sessions shorter than this are dropped as noise (accidental taps, rapid navigation bounces).
 */
export const MIN_DWELL_TIME_MS = 200;

// Cache static device attributes once at module init
const APP_VERSION = DeviceInfo.getVersion();
const OS_VERSION = String(Platform.Version);

/**
 * Get the meter instance for creating screen metrics
 */
function getScreenMeter(): Meter {
  return metrics.getMeter('lotus-screen');
}

// Lazy-initialized instruments to avoid NoopMeter trap
//
let screenDwellHistogram: Histogram | null = null;
let screenTotalTimeCounter: Counter | null = null;

/**
 * Get or create screen dwell histogram (lazy init)
 */
function getScreenDwellHistogram(): Histogram {
  if (!screenDwellHistogram) {
    screenDwellHistogram = getScreenMeter().createHistogram('lotus_screen_dwell_time_ms', {
      description: 'Screen dwell time in milliseconds per visit',
      unit: 'ms',
    });
  }
  return screenDwellHistogram;
}

/**
 * Get or create screen total time counter (lazy init)
 */
function getScreenTotalTimeCounter(): Counter {
  if (!screenTotalTimeCounter) {
    screenTotalTimeCounter = getScreenMeter().createCounter('lotus_screen_total_time_ms', {
      description: 'Cumulative total time spent per screen in milliseconds',
      unit: 'ms',
    });
  }
  return screenTotalTimeCounter;
}

// ==============================================================================
// Screen name normalization — prevents high-cardinality metric labels
// ==============================================================================

/**
 * Normalize a single route segment by replacing dynamic IDs with placeholders.
 */
function normalizeSegment(segment: string): string {
  // UUID v4 / v5 / any standard UUID shape
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
    return '[id]';
  }

  // ID-like heuristic: alphanumeric+dash, length >= 8, contains at least 2 digits
  const digitCount = (segment.match(/\d/g) ?? []).length;
  if (/^[a-z0-9-]+$/i.test(segment) && segment.length >= 8 && digitCount >= 2) {
    return '[id]';
  }

  return segment;
}

/**
 * Normalize a raw screen path (from segments.join('/')) for use as a metric label.
 * Examples:
 *   (protected)/chat/550e8400-e29b-41d4-a716-446655440000
 *     → (protected)/chat/[id]
 *
 *   (protected)/chat/abc-123-def/threads/xyz-789
 *     → (protected)/chat/[id]/threads/[id]
 */
export function normalizeScreenName(rawPath: string): string {
  return rawPath.split('/').map(normalizeSegment).join('/');
}

/**
 * Record a screen dwell event and emits:
 * - Histogram record for percentile analysis (p50/p95/p99)
 * - Counter increment for cumulative total time queries
 *
 * @param screen     Raw screen path (e.g. segments.join('/'))
 * @param durationMs Dwell time in milliseconds
 * @param exitReason Why the screen was exited: 'navigation' | 'background' | 'unmount'
 */
export function recordScreenDwell(
  screen: string,
  durationMs: number,
  exitReason: 'navigation' | 'background' | 'unmount',
): void {
  try {
    const normalizedScreen = normalizeScreenName(screen);
    const attributes = {
      screen: normalizedScreen,
      exit_reason: exitReason,
      platform: Platform.OS,
      app_version: APP_VERSION,
      os_version: OS_VERSION,
      build_type: __DEV__ ? 'debug' : 'release',
    };

    getScreenDwellHistogram().record(durationMs, attributes);
    getScreenTotalTimeCounter().add(durationMs, attributes);

    if (__DEV__) {
      console.log('[Metrics] Recorded screen dwell:', {
        screen: normalizedScreen,
        durationMs,
        exitReason,
        build_type: attributes.build_type,
      });
    }
  } catch (error) {
    logger.error(Event.LOTUS_METRIC_ERROR, { context: 'screen_dwell', error });
  }
}
