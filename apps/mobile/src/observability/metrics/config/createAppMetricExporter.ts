import {
  AggregationTemporalityPreference,
  OTLPMetricExporter,
} from '@opentelemetry/exporter-metrics-otlp-http';

export type AppMetricExporterOptions = Readonly<{
  url: string;
  timeoutMillis: number;
}>;

/**
 * MetricsService counters and histograms export as cumulative totals. Godel /
 * VictoriaMetrics ingest cumulative OTLP from long-lived app sessions; delta
 * payloads are accepted with HTTP 200 and then dropped.
 *
 * Headless notification delivery uses a separate one-shot cumulative POST in
 * `flushNotificationDeliveryMetrics.ts`, not this exporter.
 */
export function createAppMetricExporter(options: AppMetricExporterOptions): OTLPMetricExporter {
  return new OTLPMetricExporter({
    url: options.url,
    timeoutMillis: options.timeoutMillis,
    temporalityPreference: AggregationTemporalityPreference.CUMULATIVE,
  });
}
