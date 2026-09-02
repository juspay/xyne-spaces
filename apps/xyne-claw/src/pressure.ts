import { readFileSync } from "node:fs";
import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

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

function computeMemoryPct(): number {
  const v2Limit = readNumber("/sys/fs/cgroup/memory.max");
  if (v2Limit !== null && v2Limit > 0 && v2Limit < UNLIMITED_BYTES) {
    const used = readNumber("/sys/fs/cgroup/memory.current");
    if (used !== null) return (used / v2Limit) * 100;
  }

  const v1Limit = readNumber("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  if (v1Limit !== null && v1Limit > 0 && v1Limit < UNLIMITED_BYTES) {
    const used = readNumber("/sys/fs/cgroup/memory/memory.usage_in_bytes");
    if (used !== null) return (used / v1Limit) * 100;
  }

  const total = os.totalmem();
  if (total > 0) return (process.memoryUsage().rss / total) * 100;
  return 0;
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

export function describePressure(): string {
  return `mem=${memoryPressurePct().toFixed(1)}% (high=${MEM_HIGH_PCT} low=${MEM_LOW_PCT}) loop=${eventLoopDelayMs().toFixed(0)}ms streak=${loopHighStreak}/${LOOP_SUSTAIN_SAMPLES} (high=${LOOP_HIGH_MS} low=${LOOP_LOW_MS})`;
}

export function __resetPressureCacheForTests(): void {
  memCachedAt = 0;
  memCachedPct = 0;
  loopCachedAt = 0;
  loopCachedMs = 0;
  loopHighStreak = 0;
}
