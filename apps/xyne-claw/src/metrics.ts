import { createLogger } from "./logger.js";
const log = createLogger("metrics");

/**
 * Lightweight metrics facade for the agent loop.
 *
 * Why this shape: prod scrapes nothing from these pods (no Prometheus
 * endpoint), but VictoriaLogs already ingests stdout. So the default backend
 * emits ONE structured, greppable line per event that LogsQL can aggregate:
 *
 *   [metric] name=agent_empty_completion kind=count value=1 provider=codex agentSlug=euler
 *
 *   # count empty completions per provider over 24h:
 *   container:"xyne-claw" AND "[metric] name=agent_empty_completion" | stats by (provider) count()
 *
 * The call sites (`metric.count(...)` / `metric.observe(...)`) are a stable
 * boundary: when a Prometheus `/metrics` endpoint + scrape config land, swap
 * the `emit` implementation for prom-client counters/histograms and nothing
 * else changes.
 *
 * These are the signals that previously could only be found by manual log
 * spelunking: empty completions, context overflow, compaction events,
 * provider-fallback rate, session-archive failures, lock fail-opens, and
 * over-large tool-output spills.
 */

export type MetricLabels = Record<string, string | number | boolean | null | undefined>;

// Default on; set XYNE_CLAW_METRICS=off to silence (e.g. noisy local dev).
const ENABLED = (process.env["XYNE_CLAW_METRICS"] ?? "on").toLowerCase() !== "off";

function sanitize(v: string | number | boolean): string {
  // Keep it single-token so the `k=v` line stays parseable.
  return String(v).replace(/\s+/g, "_").slice(0, 120);
}

function emit(kind: "count" | "observe", name: string, value: number, labels?: MetricLabels): void {
  if (!ENABLED) return;
  const parts = [`[metric]`, `name=${name}`, `kind=${kind}`, `value=${value}`];
  if (labels) {
    for (const [k, v] of Object.entries(labels)) {
      if (v === undefined || v === null || v === "") continue;
      parts.push(`${k}=${sanitize(v)}`);
    }
  }
  log.info(parts.join(" "));
}

export const metric = {
  /** Increment a counter by 1 (or `by`). */
  count: (name: string, labels?: MetricLabels, by = 1): void => emit("count", name, by, labels),
  /** Record an observation (latency ms, token count, byte size, …). */
  observe: (name: string, value: number, labels?: MetricLabels): void => emit("observe", name, value, labels),
};
