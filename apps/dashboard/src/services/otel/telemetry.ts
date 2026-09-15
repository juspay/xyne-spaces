/**
 * OpenTelemetry Telemetry Initialization
 *
 * Initializes the OpenTelemetry SDK for metrics collection and export.
 * Metrics are sent to the OTel Collector via OTLP/HTTP protocol.
 */

import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  SEMRESATTRS_SERVICE_INSTANCE_ID,
} from '@opentelemetry/semantic-conventions';
import { metrics } from '@opentelemetry/api';
import {
  ENABLE_OTEL_METRICS,
  OTEL_METRICS_ENDPOINT,
  OTEL_EXPORT_INTERVAL_MS,
  OTEL_SERVICE_NAME,
} from '../../config';
import { detectPlatform } from '../../hooks/usePlatform';
import { logger, Event } from '../../utils/logger';

/**
 * Initialize OpenTelemetry metrics provider
 * Should be called once at application startup
 */
export function initializeTelemetry(): void {
  if (!ENABLE_OTEL_METRICS) {
    return;
  }

  try {
    // Stable per-browser device id; persisted in localStorage so it survives reloads.
    const deviceId = getOrGenerateDeviceId();
    const platformName = detectPlatform();

    // Create resource with service identification.
    // `platform.name` becomes the Prometheus label `platform_name` after OTLP→Collector
    // export and is what lets dashboards filter web/electron/mobile separately.
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: OTEL_SERVICE_NAME,
      [SEMRESATTRS_SERVICE_INSTANCE_ID]: deviceId,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- OTel semantic-convention dotted key (becomes `platform_name` in Prometheus)
      'platform.name': platformName,
    });

    // Create OTLP/HTTP exporter
    const metricExporter = new OTLPMetricExporter({
      url: OTEL_METRICS_ENDPOINT,
      // Timeout for export requests
      timeoutMillis: 10000,
    });

    // Create meter provider with periodic export
    const meterProvider = new MeterProvider({
      resource: resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: OTEL_EXPORT_INTERVAL_MS,
        }),
      ],
    });

    // Set as global meter provider
    metrics.setGlobalMeterProvider(meterProvider);

    // Register performance observers
    import('./perfMetrics')
      .then(
        ({
          registerMemoryGauge,
          registerHeapSnapshotLog,
          registerLongTaskObserver,
          registerWebVitals,
        }) => {
          registerMemoryGauge();
          registerHeapSnapshotLog();
          registerLongTaskObserver();
          registerWebVitals();
        },
      )
      .catch(() => {
        // Non-critical — perf metrics registration failed
      });

    // Emit a single bridge breadcrumb pairing the OTel `service_instance_id`
    // (= the per-browser device UUID, the only varying label on every frontend
    // metric) with the bridge's identifying envelope (`clientSessionId`,
    // `emailId`, `platformName`). This is the join key from Prometheus frontend
    // metrics back to a specific user/session in the logging-bridge stream.
    logger.info(Event.OTEL_INSTANCE_REGISTERED, {
      serviceInstanceId: deviceId,
      platformName,
    });
  } catch (error) {
    logger.error(Event.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('[OTel] Failed to initialize telemetry:'),
      error: error,
    });
    // Don't throw - telemetry failure shouldn't break the app
  }
}

function getOrGenerateDeviceId(): string {
  let id = window.localStorage.getItem('otel_device_id');
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem('otel_device_id', id);
  }
  return id;
}
