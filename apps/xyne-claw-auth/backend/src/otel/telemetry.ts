/**
 * OpenTelemetry metrics for xyne-claw-auth. Mirrors the spaces backend
 * (apps/backend/src/services/otel/telemetry.ts): OTLP/HTTP metrics only, no
 * tracing, exported to the collector at CONFIG.otelBaseUrl (default :4318).
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { errMsg } from "../lib/errors.js";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("otel");

let sdk: NodeSDK | null = null;

export function initializeOpenTelemetry(): void {
  if (!CONFIG.otelMetricsEnabled) {
    log.info("[otel] metrics disabled (ENABLE_OTEL_METRICS)");
    return;
  }
  try {
    const metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${CONFIG.otelBaseUrl}/v1/metrics`,
        timeoutMillis: 10_000,
      }),
      exportIntervalMillis: CONFIG.otelExportIntervalMs,
    });

    sdk = new NodeSDK({ serviceName: CONFIG.otelServiceName, metricReader });
    sdk.start();
    log.info(
      `[otel] metrics started for ${CONFIG.otelServiceName} -> ${CONFIG.otelBaseUrl}/v1/metrics (every ${CONFIG.otelExportIntervalMs}ms)`,
    );
  } catch (err) {
    log.error("[otel] failed to initialize:", errMsg(err));
  }
}

export async function shutdownOpenTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
    log.info("[otel] metrics shut down");
  } catch (err) {
    log.error("[otel] shutdown failed:", errMsg(err));
  }
}
