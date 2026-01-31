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
import { OTEL_METRICS_ENDPOINT, OTEL_EXPORT_INTERVAL_MS, OTEL_SERVICE_NAME } from '../../config';

/**
 * Initialize OpenTelemetry metrics provider
 * Should be called once at application startup
 */
export function initializeTelemetry(): void {
  try {
    // Create resource with service identification
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: OTEL_SERVICE_NAME,
      [SEMRESATTRS_SERVICE_INSTANCE_ID]: getOrGenerateDeviceId(),
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
