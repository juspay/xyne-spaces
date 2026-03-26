import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { config } from '../../config/env';
import { logger } from '@/utils/logger';

let sdk: NodeSDK | null = null;

function getLangfuseTraceExporter(): OTLPTraceExporter | undefined {
  const { secretKey, publicKey, baseUrl } = config.langfuse;
  if (!secretKey || !publicKey || !baseUrl) {
    return undefined;
  }

  const collectorUrl = `${baseUrl.replace(/\/$/, '')}/api/public/otel/v1/traces`;
  const authCredentials = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');

  logger.info(`[OTEL] Configuring Langfuse trace exporter -> ${collectorUrl}`);

  return new OTLPTraceExporter({
    url: collectorUrl,
    headers: { 'Authorization': `Basic ${authCredentials}` },
  });
}

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

    const traceExporter = getLangfuseTraceExporter();

    sdk = new NodeSDK({
      serviceName:  config.otel.serviceName,
      metricReader,
      ...(traceExporter && { traceExporter }),
    });

    sdk.start();
    logger.info(`[OTEL] OpenTelemetry SDK started successfully for service: ${config.otel.serviceName} (tracing: ${!!traceExporter})`);

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
