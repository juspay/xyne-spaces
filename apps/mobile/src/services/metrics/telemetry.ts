/**
 * OpenTelemetry Telemetry Initialization for Lotus
 *
 * Uses OTLP HTTP exporter to send metrics to /godel/v1/metrics
 */

import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import DeviceInfo from 'react-native-device-info';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  SEMRESATTRS_SERVICE_INSTANCE_ID,
} from '@opentelemetry/semantic-conventions';
import { metrics } from '@opentelemetry/api';
import { AppState, AppStateStatus, NativeEventSubscription, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { TELEMETRY_CONFIG } from '@/src/config';
import { logger, Event } from '@/src/utils/logger';

// Global references — module-level singletons
let globalMeterProvider: MeterProvider | null = null;
let globalAppStateSubscription: NativeEventSubscription | null = null;

/**
 * Get the global meter instance
 */
export function getMeter(name: string = TELEMETRY_CONFIG.serviceName) {
  return metrics.getMeter(name);
}

/**
 * Get device ID for OTel resource using react-native-device-info
 * SYNCHRONOUS — must not be async to avoid race conditions during init
 *
 * - iOS: Uses identifierForVendor (persists across restarts, resets on app reinstall)
 * - Android: Uses ANDROID_ID (persists across restarts and reinstalls)
 */
function getDeviceId(): string {
  try {
    return DeviceInfo.getUniqueIdSync();
  } catch {
    return uuidv4();
  }
}

/**
 * Count the total number of data points across all scope metrics.
 * Avoids the union-type flatMap issue by iterating explicitly.
 */
function countDataPoints(resourceMetrics: Parameters<OTLPMetricExporter['export']>[0]): number {
  let count = 0;
  for (const scope of resourceMetrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      count += metric.dataPoints.length;
    }
  }
  return count;
}

/**
 * Initialize OpenTelemetry telemetry for Lotus
 * Called once at app startup — defer to useEffect or setTimeout(fn, 0) in _layout
 * so Hermes timers and fetch are stable before the periodic reader schedules itself.
 */
export function initializeTelemetry(): void {
  console.log('[Telemetry] initializeTelemetry called');

  if (globalMeterProvider) {
    console.log('[Telemetry] Already initialized, skipping');
    return;
  }

  try {
    if (typeof fetch === 'undefined') {
      logger.warn(Event.LOTUS_TELEMETRY_INIT, { reason: 'fetch_not_available' });
      return;
    }

    if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
      logger.warn(Event.LOTUS_TELEMETRY_INIT, { reason: 'performance_api_not_available' });
      return;
    }

    const deviceId = getDeviceId();

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: TELEMETRY_CONFIG.serviceName,
      [SEMRESATTRS_SERVICE_INSTANCE_ID]: deviceId,
    });

    logger.info(Event.LOTUS_TELEMETRY_INIT, {
      stage: 'init_start',
      deviceId: deviceId.substring(0, 8) + '...',
      endpoint: TELEMETRY_CONFIG.metricsEndpoint,
    });

    const metricExporter = new OTLPMetricExporter({
      url: TELEMETRY_CONFIG.metricsEndpoint,
      timeoutMillis: 10000,
    });

    // Wrap exporter to log point counts and export results
    const originalExport = metricExporter.export.bind(metricExporter);
    metricExporter.export = (resourceMetrics, resultCallback) => {
      const pointCount = countDataPoints(resourceMetrics);
      console.log(
        `[Telemetry] Exporting ${pointCount} data point(s) to`,
        TELEMETRY_CONFIG.metricsEndpoint,
      );
      if (pointCount === 0) {
        // Reader fired but no instrument values recorded yet.
        // This is normal on the very first flush if metrics hooks haven't run.
        console.warn('[Telemetry] Zero data points — no instruments recorded since last flush');
      }
      originalExport(resourceMetrics, result => {
        if (result.error) {
          console.log('[Telemetry] Export failed:', result.error.message);
        } else {
          console.log('[Telemetry] Export succeeded');
        }
        resultCallback(result);
      });
    };

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: TELEMETRY_CONFIG.exportIntervalMs,
      exportTimeoutMillis: 5000, // Must be less than exportIntervalMillis
    });

    const meterProvider = new MeterProvider({ resource, readers: [metricReader] });

    // OTel global API enforces a one-time-set rule and silently ignores subsequent
    // setGlobalMeterProvider calls. In dev, Fast Refresh re-evaluates this module and
    // resets globalMeterProvider to null, but the OTel singleton still holds the old
    // provider — so the new provider becomes orphaned. Clear the internal slot first.
    if (__DEV__) {
      try {
        // @ts-expect-error — internal OTel API, dev-only reset for Fast Refresh
        metrics['_globalMeterProvider'] = undefined;
      } catch {
        // Ignore — worst case the new provider is orphaned, which only affects dev HMR
      }
    }

    metrics.setGlobalMeterProvider(meterProvider);
    globalMeterProvider = meterProvider;

    // Seed at least one instrument immediately so the first periodic flush has data.
    // Without this, the exporter is never called on cold start because the SDK skips
    // the HTTP request when collect() returns zero data points.
    const meter = metrics.getMeter(TELEMETRY_CONFIG.serviceName);
    meter
      .createCounter('app.telemetry.initialized', {
        description: 'Incremented once when telemetry initializes successfully',
      })
      .add(1, {
        'app.version': DeviceInfo.getVersion(),
        platform: Platform.OS,
        build_type: __DEV__ ? 'debug' : 'release',
      });

    // Trigger an early heartbeat so the dashboard has queryable data immediately
    // This ensures the first export includes metrics that match dashboard queries
    setTimeout(() => {
      try {
        // Lazy require: the metrics module may not be loaded yet at startup.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Avoid the metrics/telemetry initialization cycle.
        const { recordActivityHeartbeat } = require('@/src/services/metrics');
        recordActivityHeartbeat();
        console.log('[Telemetry] Seeded early heartbeat for dashboard visibility');
      } catch {
        // Ignore - metrics module might not be ready yet
      }
    }, 1000);

    // Flush pending metrics when the app goes to background
    globalAppStateSubscription?.remove();
    globalAppStateSubscription = AppState.addEventListener(
      'change',
      async (nextAppState: AppStateStatus) => {
        if (/inactive|background/.test(nextAppState)) {
          // Skip flush if device is offline — metrics will be sent on the next
          // periodic flush when connectivity returns.
          try {
            const netInfo = await NetInfo.fetch();
            if (netInfo.isConnected === false || netInfo.isInternetReachable === false) {
              logger.info(Event.LOTUS_TELEMETRY_SHUTDOWN, {
                reason: 'flush_on_background_skipped',
                deviceOffline: true,
              });
              return;
            }
          } catch {
            // Proceed with flush if NetInfo check fails
          }

          Promise.race([
            meterProvider.forceFlush().catch((e: unknown) => {
              throw e;
            }),
            new Promise<void>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      'Telemetry background flush exceeded 2500ms safety timeout. ' +
                        'Expected on slow or unstable networks. Metrics will retry on next periodic flush.',
                    ),
                  ),
                2500,
              ),
            ),
          ]).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            const isTimeout = message.includes('safety timeout');

            if (isTimeout) {
              logger.warn(Event.LOTUS_TELEMETRY_SHUTDOWN, {
                reason: 'flush_on_background_timeout',
                error: message,
                timeoutMs: 2500,
              });
            } else {
              logger.error(Event.LOTUS_TELEMETRY_SHUTDOWN, {
                reason: 'flush_on_background_failed',
                error: message,
              });
            }
          });
        }
      },
    );

    // In dev, force an early flush so you don't have to wait the full export interval
    // to confirm the pipeline is working end-to-end.
    if (__DEV__) {
      setTimeout(() => {
        console.log('[Telemetry] DEV: forcing early flush to verify pipeline');
        void meterProvider.forceFlush().then(() => {
          console.log('[Telemetry] DEV: early flush complete');
        });
      }, 5000);
    }

    logger.info(Event.LOTUS_TELEMETRY_INIT, {
      stage: 'initialized',
      exportIntervalMs: TELEMETRY_CONFIG.exportIntervalMs,
    });
    console.log('[Telemetry] Initialization complete');
  } catch (error) {
    logger.error(Event.LOTUS_TELEMETRY_INIT, { stage: 'init_failed', error });
  }
}

/**
 * Safely record a metric with error handling.
 * Prevents metric recording failures from crashing the app.
 */
export function safeRecordMetric(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    logger.error(Event.LOTUS_METRIC_ERROR, { error });
  }
}

/**
 * Shutdown telemetry gracefully.
 * Removes AppState listener, flushes pending metrics, and resets singletons
 * so initializeTelemetry() can be safely called again (e.g. after re-enrollment).
 */
export async function shutdownTelemetry(): Promise<void> {
  try {
    globalAppStateSubscription?.remove();
    globalAppStateSubscription = null;

    if (globalMeterProvider) {
      logger.info(Event.LOTUS_TELEMETRY_SHUTDOWN, { stage: 'shutdown_start' });
      await globalMeterProvider.shutdown();
      globalMeterProvider = null; // reset so re-init is possible after shutdown
      logger.info(Event.LOTUS_TELEMETRY_SHUTDOWN, { stage: 'shutdown_success' });
    }
  } catch (error) {
    logger.error(Event.LOTUS_TELEMETRY_SHUTDOWN, { stage: 'shutdown_failed', error });
  }
}

/**
 * Force flush metrics immediately.
 * Useful before app goes to background or for manual testing.
 */
export async function forceFlushMetrics(): Promise<void> {
  try {
    if (globalMeterProvider) {
      logger.info(Event.LOTUS_TELEMETRY_SHUTDOWN, { stage: 'force_flush_start' });
      await globalMeterProvider.forceFlush();
      logger.info(Event.LOTUS_TELEMETRY_SHUTDOWN, { stage: 'force_flush_success' });
    }
  } catch (error) {
    logger.error(Event.LOTUS_TELEMETRY_SHUTDOWN, { stage: 'force_flush_failed', error });
  }
}
