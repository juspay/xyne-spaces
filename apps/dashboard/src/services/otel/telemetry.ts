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
    // The Collector's prometheusremotewrite exporter only turns `service.name` into `job`
    // and `service.instance.id` into `instance`. Every other resource attribute,
    // `platform.name` included, lands solely on `target_info` and has to be read with
    // `* on(job, instance) group_left(platform_name) target_info`. Dimensions you want to
    // filter or group by directly belong on the instrument, not here.
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: OTEL_SERVICE_NAME,
      [SEMRESATTRS_SERVICE_INSTANCE_ID]: deviceId,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- OTel semantic-convention dotted key (becomes `platform_name` on `target_info`)
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

    if (window.electronAPI?.glass) {
      import('./glassMetrics')
        .then(({ registerGlassStateGauge }) => {
          registerGlassStateGauge();
        })
        .catch(() => undefined);
    }

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
    console.error('[OTel] Failed to initialize telemetry:', error);
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
