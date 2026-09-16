import { SLOW_MACHINE_SPEED_INDEX } from '../probes/cpuBenchmark';
import { confidenceFrom, fmt } from '../stats';
import type { CpuContext, DeviceInfo, MetricKey, Point } from '../../types';
import type {
  CheckResult,
  CheckStatus,
  Confidence,
  Measurement,
  ProbeResults,
  WindowSummary,
} from '../types';

/** Everything a check may look at. Checks are pure functions of this. */
export interface CheckContext {
  window: WindowSummary;
  probes: ProbeResults;
  cpu: CpuContext;
  device: DeviceInfo;
  /** True when the benchmark says this hardware is materially slower than reference. */
  machineIsSlow: boolean;
  /**
   * True when there is positive evidence the load is coming from outside Xyne —
   * a busy machine where Xyne is a small share of it, or thermal throttling.
   * Only this flag may mark a finding unactionable; hardware being slow on its
   * own never excuses an app-side fault.
   */
  loadIsExternal: boolean;
  /** True when the user did something during the window. */
  interactive: boolean;
  /**
   * True when diagnostics was actually observing a Zero client during the run.
   * Without it, "no disconnects were seen" and "we were never watching" are
   * indistinguishable, and reporting the second as a healthy connection is a
   * false pass of exactly the kind that makes a report untrustworthy.
   */
  zeroObserved: boolean;
}

export type Check = (context: CheckContext) => CheckResult | null;

/** A window this short cannot support a confident verdict about anything. */
export const MIN_CONFIDENT_WINDOW_MS = 15_000;

export function values(points: Point[] | undefined): number[] {
  return (points ?? []).map(point => point.v);
}

export function samplesOf(context: CheckContext, key: MetricKey): Point[] {
  return context.window.samples[key] ?? [];
}

/** Grades a value where smaller is better. */
export function gradeLower(value: number, warnAt: number, badAt: number): CheckStatus {
  if (value >= badAt) return 'fail';
  if (value >= warnAt) return 'warn';
  return 'pass';
}

/** Grades a value where larger is better. */
export function gradeHigher(value: number, warnAt: number, badAt: number): CheckStatus {
  if (value <= badAt) return 'fail';
  if (value <= warnAt) return 'warn';
  return 'pass';
}

const STATUS_RANK: Record<CheckStatus, number> = {
  skipped: -2,
  inconclusive: -1,
  pass: 0,
  warn: 1,
  fail: 2,
};

export function worstStatus(statuses: CheckStatus[]): CheckStatus {
  let worst: CheckStatus = 'skipped';
  for (const status of statuses) {
    if (STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
  }
  return worst;
}

export function statusRank(status: CheckStatus): number {
  return STATUS_RANK[status];
}

/**
 * Confidence for a check backed by a sampled series, accounting for the window
 * itself being too short to judge anything.
 */
export function seriesConfidence(
  context: CheckContext,
  sampleCount: number,
  mediumSamples: number,
  highSamples: number,
): { confidence: Confidence; reason: string } {
  const windowMs = context.window.durationMs;
  const seconds = Math.round(windowMs / 1000);

  if (sampleCount === 0) {
    return { confidence: 'low', reason: 'No samples were collected during the run.' };
  }
  if (windowMs < MIN_CONFIDENT_WINDOW_MS) {
    return {
      confidence: 'low',
      reason: `The run only covered ${seconds}s — too short to be sure this is typical.`,
    };
  }

  const confidence = confidenceFrom({ samples: sampleCount, mediumSamples, highSamples });
  const plural = sampleCount === 1 ? '' : 's';
  const reason =
    confidence === 'high'
      ? `${sampleCount} sample${plural} over ${seconds}s.`
      : confidence === 'medium'
        ? `${sampleCount} sample${plural} over ${seconds}s — enough to be indicative, not conclusive.`
        : `Only ${sampleCount} sample${plural} over ${seconds}s.`;
  return { confidence, reason };
}

export function measurement(label: string, value: string, against?: string): Measurement {
  return against === undefined ? { label, value } : { label, value, against };
}

export function ms(value: number | null, decimals = 0): string {
  return fmt(value, decimals, 'ms');
}

export function percent(value: number | null, decimals = 0): string {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(decimals)}%`;
}

/**
 * A check that could not run. Reported rather than omitted: "we did not measure
 * this" and "this is fine" are different statements, and silently collapsing the
 * first into the second is how a clean report stops meaning anything.
 */
export function skipped(
  id: string,
  title: string,
  category: CheckResult['category'],
  reason: string,
): CheckResult {
  return {
    id,
    title,
    category,
    status: 'skipped',
    confidence: 'low',
    confidenceReason: reason,
    // The reason is the summary. A list of rows that all read "not measured"
    // tells the reader nothing about which gap matters.
    summary: reason,
    measurements: [],
    evidence: [],
    remediation: '',
    actionable: false,
  };
}

/** The machine-context sentence appended to CPU-bound findings on slow hardware. */
export function machineCaveat(context: CheckContext): string[] {
  const index = context.probes.cpu?.speedIndex;
  if (!context.machineIsSlow || index === undefined) return [];
  return [
    `This machine benchmarks at about ${Math.round(index * 100)}% of reference speed, so the same work costs it more here than on a fast laptop.`,
  ];
}

export { SLOW_MACHINE_SPEED_INDEX };
