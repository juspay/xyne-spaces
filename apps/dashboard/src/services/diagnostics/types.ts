/**
 * Client-side performance diagnostics — shared types.
 *
 * Everything here describes what a *user* can observe about their own session.
 * Nothing in this module leaves the device unless the user explicitly exports a
 * report.
 */

export type Verdict = 'good' | 'warn' | 'bad' | 'unknown';

export const METRIC_KEYS = [
  // CPU
  'cpuPressure',
  'cpuPercent',
  'cpuSharePercent',
  'fps',
  'longTaskShare',
  'navigationBlockingMs',
  'idleCpuPercent',
  // Memory
  'heapUsedMb',
  'heapFraction',
  'rssMb',
  // Latency
  'apiLatencyP95',
  'networkRtt',
  // Zero sync
  'zeroQueryP95',
  'zeroPokeP95',
  'zeroDisconnectsPerHour',
  'zeroMutationP95',
  'zeroPendingMutations',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export interface Point {
  /** Epoch ms. */
  t: number;
  v: number;
}

export interface MetricState {
  key: MetricKey;
  /** Latest observed value, or null when nothing has been sampled yet. */
  value: number | null;
  verdict: Verdict;
  /** Raw samples from this session — roughly the last 15 minutes. */
  points: Point[];
  /** One worst-value bucket per minute across the retention window, survives reloads. */
  historyPoints: Point[];
  supported: boolean;
  /** Populated when `supported` is false, so the UI can say why rather than showing a blank. */
  unsupportedReason?: string;
}

/**
 * One script's contribution to main-thread time, from the Long Animation Frames
 * API. This is the real answer to "what is draining it" — LoAF reports the
 * actual source URL and function name, unlike `longtask` which reports nothing.
 */
export interface ScriptDrain {
  source: string;
  fn: string;
  invoker: string;
  totalMs: number;
  count: number;
  forcedLayoutMs: number;
}

export interface ApiDrain {
  /** Path template with ids collapsed, so one row doesn't become a thousand. */
  endpoint: string;
  count: number;
  totalMs: number;
  p95Ms: number;
  transferKb: number;
}

/**
 * Per-name latency for a Zero operation (a query or a mutation), aggregated
 * from the instrumentation the app already emits.
 */
export interface ZeroOpStat {
  name: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  errors: number;
  /** Verdict for this individual query, so a slow one can be highlighted on its own. */
  verdict: Verdict;
}

export type ZeroConnectionName =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'needs-auth'
  | 'error'
  | 'closed'
  | 'unknown';

export interface ZeroConnectionEvent {
  t: number;
  name: ZeroConnectionName;
  reason: string;
}

export interface ZeroConnectionHealth {
  current: ZeroConnectionName;
  currentReason: string;
  /** When diagnostics began observing this Zero instance. */
  observingSince: number | null;
  /**
   * Unexpected transitions out of `connected` within the churn window. Excludes
   * the deliberate disconnect Zero performs when the tab is hidden.
   */
  disconnects: number;
  /** Deliberate hidden-tab disconnects. Reported for context, never as a fault. */
  hiddenDisconnects: number;
  /** Most recent transitions, newest first, for the detail table. */
  recent: ZeroConnectionEvent[];
  /** Counts keyed by disconnect reason, so churn has an attributable cause. */
  reasons: { reason: string; count: number }[];
}

export interface ElectronProcessSample {
  pid: number;
  type: string;
  name: string;
  cpuPercent: number;
  workingSetMb: number;
  /** Timer wake-ups per second. A primary driver of battery use when idle. */
  idleWakeupsPerSecond: number;
}

/**
 * Machine-level CPU context, sampled in the Electron main process.
 *
 * No platform exposes per-application power draw, so CPU is the attributable
 * signal: `appCpuPercent` is Xyne's own cost, `systemCpuPercent` is everything
 * running, and the ratio is the only defensible statement we can make about how
 * much of the machine's energy Xyne is responsible for.
 */
export interface CpuContext {
  /** Sum of Xyne's processes, as a percentage of one core. */
  appCpuPercent: number | null;
  /** Whole-machine utilisation, 0..100 across all cores. */
  systemCpuPercent: number | null;
  /** Xyne's share of all CPU activity, 0..100. */
  appSharePercent: number | null;
  coreCount: number | null;
  /** macOS/Windows thermal state from Electron's powerMonitor, when available. */
  thermalState: string | null;
  onBatteryPower: boolean | null;
}

export interface DeviceInfo {
  platform: string;
  userAgent: string;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  screen: string;
  dpr: number;
  connection: {
    effectiveType: string;
    rttMs: number;
    downlinkMbps: number;
    saveData: boolean;
  } | null;
  crossOriginIsolated: boolean;
  appVersion: string | null;
  deviceId: string | null;
}

/** One thing the rules concluded, with the measurements that led there. */
export interface Finding {
  id: string;
  /** Plain-language statement of what is wrong. */
  title: string;
  /** Why we believe it — the actual numbers, never a bare assertion. */
  evidence: string[];
  /** What the user or an engineer can do about it. */
  suggestion: string;
  severity: 'bad' | 'warn';
  /** False when the cause lies outside the app, so the UI can say so. */
  actionable: boolean;
}

export interface DiagnosticsSnapshot {
  startedAt: number;
  updatedAt: number;
  /** Set when the current session hydrated history recorded before a reload. */
  historyFrom: number | null;
  metrics: Record<MetricKey, MetricState>;
  scripts: ScriptDrain[];
  api: ApiDrain[];
  longTaskCount: number;
  zeroQueries: ZeroOpStat[];
  zeroMutations: ZeroOpStat[];
  zeroConnection: ZeroConnectionHealth;
  cpu: CpuContext;
  /** Seconds since the last real interaction, used to judge idle-time cost. */
  idleForSeconds: number | null;
  device: DeviceInfo;
  electron: ElectronProcessSample[] | null;
  overall: Verdict;
}
