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
  Point,
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
  /**
   * Timestamped samples per metric, in order. Timestamps are kept because a
   * value that sits high and one that is still climbing are different findings
   * with different answers, and only the slope separates them. Derived p95
   * metrics are excluded — see `window.ts`.
   */
  samples: Partial<Record<MetricKey, Point[]>>;
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
  /**
   * Queries asked for but still unanswered when the window closed, oldest wait
   * first. Captured as state at close rather than accumulated as events, since
   * a request that never returns emits nothing to accumulate.
   */
  outstandingQueries: { name: string; waitingMs: number }[];
  /**
   * The connection's state at close, and how long the server had gone without
   * doing anything observable for this client. Captured as state rather than
   * events, because what is being described is an absence of them.
   */
  liveness: {
    connection: string;
    silentForMs: number;
    connectedForMs: number | null;
    pendingMutations: number;
  } | null;
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

/**
 * One function as the sampling profiler saw it.
 *
 * `selfMs` is the thread inside this function's own code; `totalMs` is that
 * plus everything it called. A component with a large total and a tiny self is
 * not itself slow — something beneath it is.
 */
export interface HotFrame {
  name: string;
  /**
   * Whether the frame is the app's own code or the framework underneath it.
   * A profile of a React app is overwhelmingly React's own frames; without this
   * split every report reads as "the scheduler is slow", which is true and
   * useless.
   */
  origin: 'app' | 'framework' | 'unknown';
  /**
   * Derived from React's naming convention — capitalised is a component, `use`
   * is a hook. React's internals ship pre-minified so nothing around the frame
   * can corroborate it, which makes this a labelling hint and never something a
   * verdict rests on.
   */
  kind: 'component' | 'hook' | 'function' | 'anonymous';
  resource: string;
  line: number | null;
  column: number | null;
  selfMs: number;
  totalMs: number;
  selfSharePercent: number;
  totalSharePercent: number;
}

/** Where the main thread actually went during the run. */
export interface MainThreadAttribution {
  supported: boolean;
  unsupportedReason: string;
  sampleIntervalMs: number;
  samples: number;
  /** Samples where the thread was running something rather than idle. */
  busySamples: number;
  busyMs: number;
  durationMs: number;
  /** Ranked by self time — the functions the thread was actually inside. */
  frames: HotFrame[];
  /**
   * The app's own functions, ranked by the time charged to them.
   *
   * Each sample is charged to the deepest application frame on its stack, so
   * React's reconciler and commit work counts against whichever component
   * caused it. This is the table that answers "what in *my* code is expensive",
   * which the raw self-time ranking cannot: the thread is almost never inside
   * app code at the instant it is sampled, it is inside the framework the app
   * asked to do something.
   */
  appFrames: HotFrame[];
  /** Samples whose stack contained no identifiable app frame. */
  frameworkOnlyMs: number;
  /** Ranked by total time, components only. */
  components: HotFrame[];
  /**
   * The heaviest root-to-leaf call path. Runs of consecutive framework frames
   * are collapsed into a single entry, because a dozen unbroken reconciler
   * frames push the app's own code off the end of the list — which is exactly
   * what made the first version of this unreadable.
   */
  hotPath: { name: string; totalMs: number; collapsed?: number }[];
  /**
   * True when sampling stopped before the window did because its buffer filled.
   * The numbers still describe real execution, but only of the period actually
   * sampled — which `durationMs` reports.
   */
  truncated: boolean;
  /**
   * True when measured against a development build. React's dev build does
   * substantially more work per render, so the numbers describe the dev
   * experience and must not be read as what users see.
   */
  devBuild: boolean;
}

export interface ProbeResults {
  cpu: CpuBenchmarkResult | null;
  eventLoop: EventLoopLagResult | null;
  storage: StorageProbeResult | null;
  /** Null only before the run has stopped sampling. */
  mainThread: MainThreadAttribution | null;
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
