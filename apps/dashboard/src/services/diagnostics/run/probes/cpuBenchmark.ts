import { percentile } from '../stats';
import type { CpuBenchmarkResult } from '../types';

/**
 * Fixed-workload CPU benchmark.
 *
 * This exists to separate two findings the current engine cannot tell apart:
 * "the app is slow" and "the machine is slow". Absolute thresholds alone cannot
 * do it — 400ms of blocking means something very different on a four-core
 * laptop than on a workstation — and without the distinction every slow machine
 * generates an app bug report that no app change would fix.
 *
 * It measures capability, not load. The *fastest* slice is the headline figure
 * precisely because it is the least contended one, so a benchmark that happens
 * to run beside other work still reports the hardware honestly rather than
 * reporting the interference.
 */

/**
 * Sized so one slice is ~20ms on a fast Apple Silicon laptop — deliberately
 * under the 50ms long-task threshold, so the probe can never be mistaken for
 * the jank it is measuring.
 */
const ITERATIONS = 300_000;
const SLICES = 5;
const WARMUP_ITERATIONS = 50_000;

/** Best-slice time on the reference machine. `speedIndex` is this over the measured best. */
const REFERENCE_MS = 20;

/** Beyond this ratio of median to best, even the best slice ran under interference. */
const CONTENTION_RATIO = 2.5;

/**
 * Deterministic mixed integer/float/memory work. Every result feeds the next
 * iteration and the total is returned, so no part of it can be optimised away
 * as dead code — a benchmark the JIT deletes measures nothing.
 */
function kernel(iterations: number): number {
  const buffer = new Float64Array(1024);
  let accumulator = 0;
  for (let i = 0; i < iterations; i++) {
    const x = (i * 2654435761) % 4294967296;
    const slot = i & 1023;
    const value = Math.sqrt((x % 100000) + 1) + (buffer[slot] ?? 0) * 0.5;
    buffer[slot] = value;
    accumulator += value % 7;
  }
  return accumulator + (buffer[0] ?? 0);
}

/** Yields to the event loop so the five slices do not become one long block. */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function runCpuBenchmark(): Promise<CpuBenchmarkResult> {
  // The first pass runs interpreted and would report the JIT warming up rather
  // than the hardware.
  kernel(WARMUP_ITERATIONS);
  await yieldToEventLoop();

  const times: number[] = [];
  for (let slice = 0; slice < SLICES; slice++) {
    const startedAt = performance.now();
    kernel(ITERATIONS);
    times.push(performance.now() - startedAt);
    await yieldToEventLoop();
  }

  const bestMs = Math.min(...times);
  const medianMs = percentile(times, 50) ?? bestMs;

  return {
    bestMs,
    medianMs,
    slices: SLICES,
    speedIndex: bestMs > 0 ? REFERENCE_MS / bestMs : 0,
    contended: bestMs > 0 && medianMs / bestMs >= CONTENTION_RATIO,
  };
}

/** Below this the machine is slow enough that app-side thresholds are unfair to it. */
export const SLOW_MACHINE_SPEED_INDEX = 0.45;
