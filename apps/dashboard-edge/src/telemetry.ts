import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

import type { Config } from './config.js';
import { log } from './log.js';

let sdk: NodeSDK | null = null;

export function initializeOpenTelemetry(otel: Config['otel']): void {
  if (!otel.metricsEnabled) {
    log.info('otel metrics disabled (ENABLE_OTEL_METRICS=false)');
    return;
  }
  const endpoint = `${otel.baseUrl}/v1/metrics`;
  try {
    const metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: endpoint, timeoutMillis: 10_000 }),
      exportIntervalMillis: otel.exportIntervalMs,
    });
    sdk = new NodeSDK({ serviceName: otel.serviceName, metricReader });
    sdk.start();
    log.info('otel metrics started', {
      service: otel.serviceName,
      endpoint,
      exportIntervalMs: otel.exportIntervalMs,
    });
  } catch (err) {
    log.error('otel initialisation failed', { err });
  }
}

export async function shutdownOpenTelemetry(): Promise<void> {
  if (!sdk) {
    return;
  }
  try {
    await sdk.shutdown();
    log.info('otel metrics shut down');
  } catch (err) {
    log.error('otel shutdown failed', { err });
  }
  sdk = null;
}
