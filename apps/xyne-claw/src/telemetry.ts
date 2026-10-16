import os from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { ObservableResult } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Queue, type ConnectionOptions } from "bullmq";
import { createLogger } from "./logger.js";
import { heapPressurePct, memoryPressurePct } from "./pressure.js";

const log = createLogger("otel");

const ENABLED = (process.env["ENABLE_OTEL_METRICS"] ?? "false").trim().toLowerCase() === "true";
const BASE_URL = (process.env["OTEL_BASE_URL"] ?? "http://localhost:4318").replace(/\/+$/, "");
const SERVICE_NAME = process.env["OTEL_SERVICE_NAME"] ?? "xyne-claw";
const EXPORT_INTERVAL_MS = Number(process.env["OTEL_EXPORT_INTERVAL_MS"]) > 0 ? Number(process.env["OTEL_EXPORT_INTERVAL_MS"]) : 15_000;

let provider: MeterProvider | null = null;
let queue: Queue | null = null;

function loopUtilizationSampler(): () => number {
  let previous = performance.eventLoopUtilization();
  return () => {
    const current = performance.eventLoopUtilization();
    const value = performance.eventLoopUtilization(current, previous).utilization;
    previous = current;
    return value;
  };
}

function loopDelayP99Sampler(): () => number {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  return () => {
    const p99 = histogram.percentile(99) / 1e6;
    histogram.reset();
    return Number.isFinite(p99) ? p99 : 0;
  };
}

export interface TelemetrySources {
  activeRuns: () => number;
  runCapacity: number;
  runQueue: { name: string; connection: ConnectionOptions } | null;
}

export function startTelemetry({ activeRuns, runCapacity, runQueue }: TelemetrySources): void {
  if (!ENABLED) {
    log.info("[otel] metrics disabled (ENABLE_OTEL_METRICS)");
    return;
  }
  try {
    provider = new MeterProvider({
      resource: resourceFromAttributes({ "service.name": SERVICE_NAME, "host.name": os.hostname() }),
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${BASE_URL}/v1/metrics`, timeoutMillis: 10_000 }),
          exportIntervalMillis: EXPORT_INTERVAL_MS,
        }),
      ],
    });
    const meter = provider.getMeter("xyne-claw");
    const loopUtilization = loopUtilizationSampler();
    const loopDelayP99 = loopDelayP99Sampler();

    meter.createObservableGauge("claw_active_runs", { description: "Runs executing on this pod" })
      .addCallback((result) => result.observe(activeRuns()));
    meter.createObservableGauge("claw_run_capacity", { description: "Per-pod run cap (RUN_QUEUE_CONCURRENCY)" })
      .addCallback((result) => result.observe(runCapacity));
    meter.createObservableGauge("claw_eventloop_utilization", { description: "Share of the export interval the main thread was busy, 0-1" })
      .addCallback((result) => result.observe(loopUtilization()));
    meter.createObservableGauge("claw_eventloop_delay_p99_seconds", { description: "Main-thread delay p99 over the export interval" })
      .addCallback((result) => result.observe(loopDelayP99() / 1000));
    meter.createObservableGauge("claw_memory_pressure_pct", { description: "Container memory or V8 heap use, whichever is higher" })
      .addCallback((result) => result.observe(memoryPressurePct()));
    meter.createObservableGauge("claw_heap_pressure_pct", { description: "V8 heap used against its limit" })
      .addCallback((result) => result.observe(heapPressurePct()));

    if (runQueue) {
      queue = new Queue(runQueue.name, { connection: runQueue.connection });
      meter.createObservableGauge("claw_run_queue_jobs", { description: "Jobs in the run-execution queue by state (cluster-wide)" })
        .addCallback(async (result: ObservableResult) => {
          try {
            const counts = await queue!.getJobCounts("waiting", "prioritized", "delayed", "active");
            result.observe((counts["waiting"] ?? 0) + (counts["prioritized"] ?? 0), { state: "waiting" });
            result.observe(counts["delayed"] ?? 0, { state: "delayed" });
            result.observe(counts["active"] ?? 0, { state: "active" });
          } catch (err) {
            log.warn(`[otel] run queue counts failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
    }

    log.info(`[otel] metrics started for ${SERVICE_NAME} -> ${BASE_URL}/v1/metrics (every ${EXPORT_INTERVAL_MS}ms)`);
  } catch (err) {
    log.error(`[otel] failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function stopTelemetry(): Promise<void> {
  await Promise.allSettled([provider?.shutdown(), queue?.close()]);
  provider = null;
  queue = null;
}
