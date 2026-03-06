import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { config } from '../../config/env';
import { logger } from '@/utils/logger';

let sdk: NodeSDK | null = null;

export function initializeOpenTelemetry(): void {
  try {
    const metricsEndpoint = `${config.otel.baseUrl}/v1/metrics`;
    const metricExporter = new OTLPMetricExporter({
      url: metricsEndpoint,
      timeoutMillis: 10000,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: config.otel.exportIntervalMs,
    });

    sdk = new NodeSDK({
      serviceName:  config.otel.serviceName,
      metricReader,
    });

    sdk.start();
    logger.info(`[OTEL] OpenTelemetry SDK started successfully for service: ${config.otel.serviceName}`);
    
  } catch (error) {
    logger.error('[OTEL] Failed to initialize OpenTelemetry:', error);
  }
}

export async function shutdownOpenTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      logger.info('[OTEL] OpenTelemetry SDK shut down');
    } catch (err) {
      logger.error('[OTEL] Error shutting down OpenTelemetry SDK', err);
    }
  }
}
