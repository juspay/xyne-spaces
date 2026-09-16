/**
 * A diagnostic *run* — the Windows-troubleshooter half of this module.
 *
 * The live panel answers "how is the app right now". A run answers a different
 * question: "the app is misbehaving, what is wrong". It does that by measuring a
 * bounded window rather than a whole session, because every attribution the
 * session view carries is a cumulative counter with no time dimension, and a
 * four-hour total cannot be compared against a thirty-second symptom.
 *
 * A run makes no network requests of its own and calls no model. Everything it
 * concludes is derived on-device from measurements it can show the user.
 */
import type {
  ApiDrain,
  CpuContext,
  DeviceInfo,
  ElectronProcessSample,
  MetricKey,
  ScriptDrain,
  ZeroConnectionEvent,
  ZeroConnectionName,
  ZeroOpStat,
} from '../types';

/** Raw, timestamped events captured only while a run is in progress. */
export type RunEvent =
  | { kind: 'metric'; t: number; key: MetricKey; v: number }
  | { kind: 'longTask'; t: number; durationMs: number }
  | {
      kind: 'script';
      t: number;
      source: string;
      fn: string;
      invoker: string;
      totalMs: number;
      forcedLayoutMs: number;
    }
  | { kind: 'api'; t: number; endpoint: string; durationMs: number; transferBytes: number }
  | {
      kind: 'zeroOp';
      t: number;
      op: 'query' | 'mutation';
      name: string;
      durationMs: number | null;
      error: boolean;
    }
  | { kind: 'connection'; t: number; name: ZeroConnectionName; reason: string }
  | { kind: 'processes'; t: number; samples: ElectronProcessSample[] }
  | { kind: 'interaction'; t: number };

/** One Electron process across the whole window, rather than at a single instant. */
export interface ProcessWindowStat {
  pid: number;
  type: string;
  name: string;
  avgCpuPercent: number;
  peakCpuPercent: number;
  avgWorkingSetMb: number;
  peakIdleWakeupsPerSecond: number;
  samples: number;
}

/** Everything observed between the run's start and end, and nothing outside it. */
export interface WindowSummary {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** Raw samples per metric, in order. Derived p95 metrics are excluded — see `window.ts`. */
  samples: Partial<Record<MetricKey, number[]>>;
  longTasks: { t: number; durationMs: number }[];
  /** Total main-thread time spent inside long tasks during the window. */
  blockedMs: number;
  /** Longest single block. A user feels one 2s freeze far more than forty 50ms ones. */
  longestBlockMs: number;
  scripts: ScriptDrain[];
  scriptTotalMs: number;
  api: ApiDrain[];
  apiDurations: number[];
  zeroQueries: ZeroOpStat[];
  zeroQueryDurations: number[];
  zeroMutations: ZeroOpStat[];
  zeroMutationDurations: number[];
  connectionEvents: ZeroConnectionEvent[];
  /** Unexpected drops in the window; deliberate hidden-tab drops are excluded. */
  disconnects: number;
  hiddenDisconnects: number;
  processes: ProcessWindowStat[];
  processSampleCount: number;
  interactions: number;
  /** True when the tab was hidden at any point, which invalidates frame-rate data. */
  wasHidden: boolean;
}

/**
 * Fixed-workload CPU benchmark. Its purpose is not to score the machine but to
 * separate "this app is slow" from "this machine is slow" — the distinction the
 * current engine cannot make, and the one that decides whether a finding is
 * actionable by us at all.
 */
export interface CpuBenchmarkResult {
  /** Fastest slice, in ms. Least-contended run is the truest read of the hardware. */
  bestMs: number;
  medianMs: number;
  slices: number;
  /** Reference time / best time. 1.0 is the reference machine; 0.5 is half its speed. */
  speedIndex: number;
  /** Set when other work interfered so much that even the best slice is suspect. */
  contended: boolean;
}

/**
 * Timer-drift measurement. Long tasks report blocking the *browser* noticed;
 * event-loop lag reports the delay a user's click would actually have suffered,
 * including time lost to work too fragmented to register as a long task.
 */
export interface EventLoopLagResult {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** Share of ticks that arrived more than 50ms late. */
  stalledSharePercent: number;
}

/** IndexedDB timing. Zero's client store is IDB-backed, so slow IDB reads as a slow app. */
export interface StorageProbeResult {
  supported: boolean;
  unsupportedReason: string;
  writeMs: number;
  readMs: number;
  deleteMs: number;
  bytes: number;
  writeMbPerSecond: number;
  /** Bytes the origin is using, and its quota, when the browser reports them. */
  usageMb: number | null;
  quotaMb: number | null;
}

export interface ProbeResults {
  cpu: CpuBenchmarkResult | null;
  eventLoop: EventLoopLagResult | null;
  storage: StorageProbeResult | null;
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'inconclusive' | 'skipped';

/**
 * How much the evidence supports the verdict. Reported alongside every status
 * rather than instead of one: a low-confidence failure is still worth showing,
 * it just must not be stated as flatly as a high-confidence one.
 */
export type Confidence = 'low' | 'medium' | 'high';

export interface Measurement {
  label: string;
  value: string;
  /** Threshold text, when the value was graded against one. */
  against?: string;
}

/** One named test, its verdict, and the working that produced it. */
export interface CheckResult {
  id: string;
  title: string;
  category: 'responsiveness' | 'memory' | 'sync' | 'network' | 'storage' | 'machine';
  status: CheckStatus;
  confidence: Confidence;
  /** Why confidence is what it is: sample counts, window length, interference. */
  confidenceReason: string;
  summary: string;
  measurements: Measurement[];
  evidence: string[];
  remediation: string;
  /** False when the cause lies outside the app and no app change would help. */
  actionable: boolean;
}

export type RunPhase =
  | 'idle'
  | 'preparing'
  | 'probing'
  | 'observing'
  | 'analysing'
  | 'done'
  | 'cancelled'
  | 'failed';

export interface RunProgress {
  phase: RunPhase;
  /** 0..1 across the whole run, for a determinate progress bar. */
  fraction: number;
  label: string;
  secondsRemaining: number | null;
  error: string | null;
}

export interface RunReport {
  id: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** Bumped when thresholds or checks change, so old reports are not compared to new ones. */
  engineVersion: number;
  window: WindowSummary;
  probes: ProbeResults;
  checks: CheckResult[];
  overall: CheckStatus;
  headline: string;
  device: DeviceInfo;
  cpu: CpuContext;
  route: string;
  /**
   * True when the user interacted during the window. An idle run and a run where
   * someone was actively reproducing a problem are not comparable.
   */
  interactedDuringRun: boolean;
}

export const ENGINE_VERSION = 1;
