import { readFileSync } from "node:fs";
import os from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import v8 from "node:v8";
import { metric } from "./metrics.js";

const MEM_HIGH_PCT = numEnv("RUN_PRESSURE_MEM_HIGH_PCT", 85);
const MEM_LOW_PCT = numEnv("RUN_PRESSURE_MEM_LOW_PCT", 70);
const LOOP_HIGH_MS = numEnv("RUN_PRESSURE_LOOP_HIGH_MS", 100);
const LOOP_LOW_MS = numEnv("RUN_PRESSURE_LOOP_LOW_MS", 50);
const LOOP_SUSTAIN_SAMPLES = numEnv("RUN_PRESSURE_LOOP_SUSTAIN_SAMPLES", 3);
export const PRESSURE_CHECK_INTERVAL_MS = numEnv("RUN_PRESSURE_CHECK_INTERVAL_MS", 2000);

const MEM_CACHE_MS = 1_000;
const UNLIMITED_BYTES = 2 ** 60;

function numEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNumber(path: string): number | null {
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw || raw === "max") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let memCachedAt = 0;
let memCachedPct = 0;

function ownCgroupDir(): string {
  try {
    const line = readFileSync("/proc/self/cgroup", "utf8")
      .split("\n")
      .find((l) => l.startsWith("0::"));
    const path = line?.slice(3).trim();
    if (path && path !== "/") return `/sys/fs/cgroup${path}`;
  } catch {}
  return "/sys/fs/cgroup";
}

const CGROUP_DIR = ownCgroupDir();
const CONFIGURED_LIMIT_BYTES = numEnv("RUN_PRESSURE_MEMORY_LIMIT_BYTES", 0);

function inactiveFileBytes(dir: string): number {
  try {
    const line = readFileSync(`${dir}/memory.stat`, "utf8")
      .split("\n")
      .find((l) => l.startsWith("inactive_file "));
    const parsed = Number(line?.split(" ")[1]);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function v2WorkingSet(dir: string): number | null {
  const current = readNumber(`${dir}/memory.current`);
  if (current === null) return null;
  return Math.max(0, current - inactiveFileBytes(dir));
}

function usableLimit(value: number | null): number | null {
  return value !== null && value > 0 && value < UNLIMITED_BYTES ? value : null;
}

function containerMemoryPct(): number {
  const dirs = CGROUP_DIR === "/sys/fs/cgroup" ? [CGROUP_DIR] : [CGROUP_DIR, "/sys/fs/cgroup"];
  for (const dir of dirs) {
    const limit = usableLimit(CONFIGURED_LIMIT_BYTES || null) ?? usableLimit(readNumber(`${dir}/memory.max`));
    if (limit === null) continue;
    const used = v2WorkingSet(dir);
    if (used !== null) return (used / limit) * 100;
  }

  const v1Limit = usableLimit(readNumber("/sys/fs/cgroup/memory/memory.limit_in_bytes"));
  if (v1Limit !== null) {
    const used = readNumber("/sys/fs/cgroup/memory/memory.usage_in_bytes");
    if (used !== null) return (used / v1Limit) * 100;
  }

  if (CONFIGURED_LIMIT_BYTES > 0) {
    const used = v2WorkingSet(CGROUP_DIR);
    return ((used ?? process.memoryUsage().rss) / CONFIGURED_LIMIT_BYTES) * 100;
  }

  const total = os.totalmem();
  if (total > 0) return (process.memoryUsage().rss / total) * 100;
  return 0;
}

export function heapPressurePct(): number {
  const { used_heap_size, heap_size_limit } = v8.getHeapStatistics();
  return heap_size_limit > 0 ? (used_heap_size / heap_size_limit) * 100 : 0;
}

function computeMemoryPct(): number {
  return Math.max(containerMemoryPct(), heapPressurePct());
}

export function memoryPressurePct(): number {
  const now = Date.now();
  if (now - memCachedAt < MEM_CACHE_MS) return memCachedPct;
  memCachedPct = computeMemoryPct();
  memCachedAt = now;
  return memCachedPct;
}

const loopHistogram = monitorEventLoopDelay({ resolution: 10 });
loopHistogram.enable();

let loopCachedAt = 0;
let loopCachedMs = 0;
let loopHighStreak = 0;

export function eventLoopDelayMs(): number {
  const now = Date.now();
  if (now - loopCachedAt < MEM_CACHE_MS) return loopCachedMs;
  const p95 = loopHistogram.percentile(95) / 1e6;
  loopHistogram.reset();
  loopCachedMs = Number.isFinite(p95) ? p95 : 0;
  loopCachedAt = now;
  loopHighStreak = loopCachedMs >= LOOP_HIGH_MS ? loopHighStreak + 1 : 0;
  return loopCachedMs;
}

function loopSustainedHigh(): boolean {
  eventLoopDelayMs();
  return loopHighStreak >= LOOP_SUSTAIN_SAMPLES;
}

export function isUnderPressure(): boolean {
  return memoryPressurePct() >= MEM_HIGH_PCT || loopSustainedHigh();
}

export function overHighWater(): boolean {
  return isUnderPressure();
}

export function underLowWater(): boolean {
  return memoryPressurePct() < MEM_LOW_PCT && eventLoopDelayMs() < LOOP_LOW_MS;
}

let eluPrevious = performance.eventLoopUtilization();

export function eventLoopUtilization(): number {
  const current = performance.eventLoopUtilization();
  const delta = performance.eventLoopUtilization(current, eluPrevious);
  eluPrevious = current;
  return delta.utilization;
}

const PRESSURE_METRIC_INTERVAL_MS = numEnv("RUN_PRESSURE_METRIC_INTERVAL_MS", 15_000);

export function startPressureMetrics(activeRuns: () => number): void {
  eventLoopUtilization();
  setInterval(() => {
    metric.observe("claw_pressure", Math.round(memoryPressurePct() * 10) / 10, {
      heap_pct: Math.round(heapPressurePct()),
      loop_p95_ms: Math.round(eventLoopDelayMs()),
      elu: Math.round(eventLoopUtilization() * 100) / 100,
      active_runs: activeRuns(),
    });
  }, PRESSURE_METRIC_INTERVAL_MS).unref();
}

export function describePressure(): string {
  return `mem=${memoryPressurePct().toFixed(1)}% heap=${heapPressurePct().toFixed(1)}% (high=${MEM_HIGH_PCT} low=${MEM_LOW_PCT}) loop=${eventLoopDelayMs().toFixed(0)}ms streak=${loopHighStreak}/${LOOP_SUSTAIN_SAMPLES} (high=${LOOP_HIGH_MS} low=${LOOP_LOW_MS})`;
}

export function __resetPressureCacheForTests(): void {
  memCachedAt = 0;
  memCachedPct = 0;
  loopCachedAt = 0;
  loopCachedMs = 0;
  loopHighStreak = 0;
}
