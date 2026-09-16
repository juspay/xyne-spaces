import { RingBuffer, percentile } from './ringBuffer';
import type { RunWindow } from './run/window';
import { METRIC_SPECS, verdictFor, worstVerdict } from './thresholds';
import { METRIC_KEYS } from './types';
import type {
  ApiDrain,
  CpuContext,
  ZeroConnectionEvent,
  ZeroConnectionHealth,
  ZeroConnectionName,
  ZeroOpStat,
  DeviceInfo,
  DiagnosticsSnapshot,
  ElectronProcessSample,
  MetricKey,
  MetricState,
  Point,
  ScriptDrain,
  Verdict,
} from './types';

/** ~15 min of once-a-second samples; vitals fire far less often and share the budget. */
const POINTS_PER_METRIC = 900;
const LONG_TASK_CAPACITY = 400;
const LATENCY_SAMPLE_CAPACITY = 300;
const MAX_SCRIPT_ROWS = 200;
const MAX_API_ROWS = 200;

const CONNECTION_EVENT_CAPACITY = 100;
/** Churn is judged over the last hour; older drops are not what a user is feeling now. */
const CHURN_WINDOW_MS = 60 * 60 * 1000;
/**
 * Below this the observed window is too short to turn a single drop into an
 * hourly rate without inventing a number like "120 reconnects/hr" from one blip.
 */
const MIN_CHURN_OBSERVATION_MS = 2 * 60 * 1000;
const MAX_ZERO_OP_ROWS = 200;

const HISTORY_BUCKET_MS = 60_000;
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * The panel re-renders off this store, so an unthrottled notify would let the
 * diagnostics tool become the jank it is meant to measure. 250ms is fast enough
 * to feel live and slow enough to stay off the critical path.
 */
const NOTIFY_INTERVAL_MS = 250;

interface ScriptAccumulator {
  source: string;
  fn: string;
  invoker: string;
  totalMs: number;
  count: number;
  forcedLayoutMs: number;
}

interface ZeroOpAccumulator {
  name: string;
  count: number;
  errors: number;
  maxMs: number;
  durations: number[];
}

interface ApiAccumulator {
  endpoint: string;
  count: number;
  totalMs: number;
  transferBytes: number;
  durations: number[];
}

const EMPTY_ZERO_CONNECTION: ZeroConnectionHealth = {
  current: 'unknown',
  currentReason: '',
  observingSince: null,
  disconnects: 0,
  hiddenDisconnects: 0,
  recent: [],
  reasons: [],
};

/**
 * Zero deliberately drops the socket once a tab has been hidden for
 * `hiddenTabDisconnectDelay`, so these are expected and must not be counted as
 * faults. Zero only exposes the reason as a free-text message (see
 * `connection.js#mapConnectionManagerState`, which forwards `reason.message`),
 * so matching the text is the only option available to us. If Zero ever changes
 * the wording, the drop is counted as unexpected rather than silently hidden —
 * the safe direction to fail in.
 */
const HIDDEN_TAB_REASON = /tab was hidden/i;

export function isHiddenTabDisconnect(reason: string): boolean {
  return HIDDEN_TAB_REASON.test(reason);
}

const EMPTY_CPU: CpuContext = {
  appCpuPercent: null,
  systemCpuPercent: null,
  appSharePercent: null,
  coreCount: null,
  thermalState: null,
  onBatteryPower: null,
};

export class DiagnosticsStore {
  readonly startedAt = Date.now();

  private readonly series = new Map<MetricKey, RingBuffer<Point>>();
  /**
   * Minute buckets covering the retention window, kept separately from `series`.
   * The live ring holds ~15 minutes at one sample a second, so folding history
   * into it would evict everything recovered from IndexedDB shortly after boot —
   * exactly defeating the point of persisting it.
   */
  private readonly history = new Map<MetricKey, Point[]>();
  private readonly latest = new Map<MetricKey, number>();
  private readonly unsupported = new Map<MetricKey, string>();
  private readonly latencySamples = new Map<MetricKey, RingBuffer<number>>();
  private readonly longTasks = new RingBuffer<{ t: number; d: number }>(LONG_TASK_CAPACITY);
  private readonly scripts = new Map<string, ScriptAccumulator>();
  private readonly api = new Map<string, ApiAccumulator>();
  private readonly zeroQueries = new Map<string, ZeroOpAccumulator>();
  private readonly zeroMutations = new Map<string, ZeroOpAccumulator>();
  private readonly connectionEvents = new RingBuffer<ZeroConnectionEvent>(
    CONNECTION_EVENT_CAPACITY,
  );

  private connectionCurrent: ZeroConnectionName = 'unknown';
  private connectionReason = '';
  private connectionObservingSince: number | null = null;
  /** Accumulated time in a non-connected state, excluding the current stretch. */
  private connectionOfflineMs = 0;
  private connectionStateSince = 0;

  private lastLongTaskEndedAt = 0;
  private lastInteractionAt = Date.now();
  private navigationStartedAt: number | null = null;
  private navigationRoute = '';

  private cpu: CpuContext = EMPTY_CPU;
  private device: DeviceInfo | null = null;
  private electron: ElectronProcessSample[] | null = null;
  private historyFrom: number | null = null;

  /**
   * Set only while a diagnostic run is in progress. Every recording path
   * forwards its raw, timestamped event here as well, which is what lets a run
   * report on a bounded window while the session aggregates above stay
   * untouched. Type-only import, so this introduces no runtime cycle.
   */
  private runWindow: RunWindow | null = null;

  private listeners = new Set<() => void>();
  private cached: DiagnosticsSnapshot | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Recording ────────────────────────────────────────────────────────────

  record(key: MetricKey, value: number, at: number = Date.now()): void {
    if (!Number.isFinite(value)) return;
    let buffer = this.series.get(key);
    if (!buffer) {
      buffer = new RingBuffer<Point>(POINTS_PER_METRIC);
      this.series.set(key, buffer);
    }
    buffer.push({ t: at, v: value });
    this.runWindow?.push({ kind: 'metric', t: at, key, v: value });
    this.foldIntoHistory(key, value, at);
    this.latest.set(key, value);
    this.unsupported.delete(key);
    this.invalidate();
  }

  /**
   * Accumulates the retained series one bucket at a time, so the 24h view stays
   * current without ever re-scanning the raw samples. Each bucket keeps the
   * *worst* value in its minute: averaging would smooth away the spikes that are
   * the entire reason someone opens this panel.
   */
  private foldIntoHistory(key: MetricKey, value: number, at: number): void {
    const bucket = Math.floor(at / HISTORY_BUCKET_MS) * HISTORY_BUCKET_MS;
    let points = this.history.get(key);
    if (!points) {
      points = [];
      this.history.set(key, points);
    }

    const last = points[points.length - 1];
    if (last && last.t === bucket) {
      const worse = METRIC_SPECS[key].direction === 'lower' ? value > last.v : value < last.v;
      if (worse) last.v = value;
    } else {
      points.push({ t: bucket, v: value });
    }

    const cutoff = at - HISTORY_RETENTION_MS;
    while (points.length > 0 && (points[0] as Point).t < cutoff) points.shift();
  }

  /**
   * Feed an individual duration into a percentile-backed metric. The metric's
   * own value is the rolling p95, not the last sample — a single fast request
   * should not repaint a red tile green.
   */
  recordLatencySample(key: MetricKey, durationMs: number): void {
    if (!Number.isFinite(durationMs)) return;
    let buffer = this.latencySamples.get(key);
    if (!buffer) {
      buffer = new RingBuffer<number>(LATENCY_SAMPLE_CAPACITY);
      this.latencySamples.set(key, buffer);
    }
    buffer.push(durationMs);
    const p95 = percentile(buffer.toArray(), 95);
    if (p95 !== null) this.record(key, p95);
  }

  markUnsupported(key: MetricKey, reason: string): void {
    if (this.latest.has(key)) return;
    this.unsupported.set(key, reason);
    this.invalidate();
  }

  recordLongTask(durationMs: number, at: number = Date.now()): void {
    this.longTasks.push({ t: at, d: durationMs });
    this.runWindow?.push({ kind: 'longTask', t: at, durationMs });
    this.lastLongTaskEndedAt = Math.max(this.lastLongTaskEndedAt, at + durationMs);
    this.invalidate();
  }

  /** End of the most recent main-thread block, used to judge when a screen settled. */
  lastBlockEndedAt(): number {
    return this.lastLongTaskEndedAt;
  }

  markInteraction(at: number = Date.now()): void {
    this.lastInteractionAt = at;
    this.runWindow?.push({ kind: 'interaction', t: at });
  }

  idleForMs(now: number = Date.now()): number {
    return Math.max(0, now - this.lastInteractionAt);
  }

  /**
   * Opens a navigation measurement window. Only the blocking that follows is
   * attributed to it — data still loading is a separate concern, already
   * covered by query latency.
   */
  beginNavigation(route: string, at: number = Date.now()): void {
    this.navigationStartedAt = at;
    this.navigationRoute = route;
  }

  /**
   * Closes the window once the main thread has been quiet, recording how long
   * the app was frozen after the navigation.
   */
  settleNavigation(at: number = Date.now()): void {
    const startedAt = this.navigationStartedAt;
    if (startedAt === null) return;
    this.navigationStartedAt = null;
    const blockedUntil = Math.max(startedAt, this.lastLongTaskEndedAt);
    this.record('navigationBlockingMs', Math.max(0, Math.min(blockedUntil, at) - startedAt), at);
  }

  pendingNavigationRoute(): string | null {
    return this.navigationStartedAt === null ? null : this.navigationRoute;
  }

  /** Share of the last `windowMs` spent in tasks that blocked the main thread. */
  longTaskShare(windowMs: number, now: number = Date.now()): number {
    const cutoff = now - windowMs;
    // The long-task observer replays buffered entries from navigation start,
    // which predates this store. Measuring elapsed time from `startedAt` would
    // therefore divide real blocking by a near-zero denominator on every cold
    // start and pin the metric to 100%. The page's own lifetime is the correct
    // denominator for entries the page reported.
    const observableSince = Math.max(cutoff, performance.timeOrigin);
    const elapsed = now - observableSince;
    if (elapsed <= 0) return 0;
    let blocked = 0;
    for (const task of this.longTasks.toArray()) {
      if (task.t >= cutoff) blocked += task.d;
    }
    return Math.min(100, (blocked / elapsed) * 100);
  }

  recordScript(entry: Omit<ScriptDrain, 'count'> & { count?: number }): void {
    this.runWindow?.push({
      kind: 'script',
      t: Date.now(),
      source: entry.source,
      fn: entry.fn,
      invoker: entry.invoker,
      totalMs: entry.totalMs,
      forcedLayoutMs: entry.forcedLayoutMs,
    });
    const key = `${entry.source}::${entry.fn}`;
    const existing = this.scripts.get(key);
    if (existing) {
      existing.totalMs += entry.totalMs;
      existing.count += entry.count ?? 1;
      existing.forcedLayoutMs += entry.forcedLayoutMs;
    } else {
      if (this.scripts.size >= MAX_SCRIPT_ROWS) this.evictSmallest(this.scripts);
      this.scripts.set(key, {
        source: entry.source,
        fn: entry.fn,
        invoker: entry.invoker,
        totalMs: entry.totalMs,
        count: entry.count ?? 1,
        forcedLayoutMs: entry.forcedLayoutMs,
      });
    }
    this.invalidate();
  }

  recordApiCall(endpoint: string, durationMs: number, transferBytes: number): void {
    this.runWindow?.push({ kind: 'api', t: Date.now(), endpoint, durationMs, transferBytes });
    const existing = this.api.get(endpoint);
    if (existing) {
      existing.count += 1;
      existing.totalMs += durationMs;
      existing.transferBytes += transferBytes;
      existing.durations.push(durationMs);
      if (existing.durations.length > LATENCY_SAMPLE_CAPACITY) existing.durations.shift();
    } else {
      if (this.api.size >= MAX_API_ROWS) this.evictSmallest(this.api);
      this.api.set(endpoint, {
        endpoint,
        count: 1,
        totalMs: durationMs,
        transferBytes,
        durations: [durationMs],
      });
    }
    this.recordLatencySample('apiLatencyP95', durationMs);
  }

  /**
   * A completed Zero query, keyed by the query name the app already tags its
   * instrumentation with. Feeds both the overall p95 tile and the per-query
   * table that highlights which specific query is slow.
   */
  recordZeroQuery(name: string, durationMs: number): void {
    this.pushZeroOpEvent('query', name, durationMs, false);
    this.recordZeroOp(this.zeroQueries, name, durationMs);
    this.recordLatencySample('zeroQueryP95', durationMs);
  }

  recordZeroQueryError(name: string): void {
    this.pushZeroOpEvent('query', name, null, true);
    this.bumpZeroOpError(this.zeroQueries, name);
  }

  /** A mutation that the server has acknowledged (or rejected). */
  recordZeroMutation(name: string, durationMs: number): void {
    this.pushZeroOpEvent('mutation', name, durationMs, false);
    this.recordZeroOp(this.zeroMutations, name, durationMs);
    this.recordLatencySample('zeroMutationP95', durationMs);
  }

  recordZeroMutationError(name: string): void {
    this.pushZeroOpEvent('mutation', name, null, true);
    this.bumpZeroOpError(this.zeroMutations, name);
  }

  setPendingMutations(count: number): void {
    this.record('zeroPendingMutations', count);
  }

  private recordZeroOp(
    map: Map<string, ZeroOpAccumulator>,
    name: string,
    durationMs: number,
  ): void {
    if (!Number.isFinite(durationMs)) return;
    const existing = map.get(name);
    if (existing) {
      existing.count += 1;
      existing.maxMs = Math.max(existing.maxMs, durationMs);
      existing.durations.push(durationMs);
      if (existing.durations.length > LATENCY_SAMPLE_CAPACITY) existing.durations.shift();
    } else {
      if (map.size >= MAX_ZERO_OP_ROWS) evictFewestCalls(map);
      map.set(name, { name, count: 1, errors: 0, maxMs: durationMs, durations: [durationMs] });
    }
    this.invalidate();
  }

  private bumpZeroOpError(map: Map<string, ZeroOpAccumulator>, name: string): void {
    const existing = map.get(name);
    if (existing) {
      existing.errors += 1;
    } else {
      if (map.size >= MAX_ZERO_OP_ROWS) evictFewestCalls(map);
      map.set(name, { name, count: 0, errors: 1, maxMs: 0, durations: [] });
    }
    this.invalidate();
  }

  /**
   * Records a Zero connection transition. Called for every state change, so the
   * offline accounting below is exact rather than sampled.
   */
  recordConnectionState(name: ZeroConnectionName, reason: string, at: number = Date.now()): void {
    if (this.connectionObservingSince === null) {
      this.connectionObservingSince = at;
      this.connectionStateSince = at;
    } else if (this.connectionCurrent !== 'connected') {
      // Close out the stretch that just ended before moving to the new state.
      this.connectionOfflineMs += Math.max(0, at - this.connectionStateSince);
    }

    const changed = name !== this.connectionCurrent;
    this.connectionCurrent = name;
    this.connectionReason = reason;
    this.connectionStateSince = at;

    if (changed) {
      this.connectionEvents.push({ t: at, name, reason });
      this.runWindow?.push({ kind: 'connection', t: at, name, reason });
    }
    this.refreshConnectionMetrics(at);
  }

  /**
   * Recomputes the churn and offline metrics. Also called on a timer, because
   * a connection that stays down produces no further transitions yet is getting
   * steadily worse.
   */
  refreshConnectionMetrics(now: number = Date.now()): void {
    const since = this.connectionObservingSince;
    if (since === null) return;

    const observed = now - since;
    const offline =
      this.connectionOfflineMs +
      (this.connectionCurrent === 'connected' ? 0 : Math.max(0, now - this.connectionStateSince));

    void offline;

    // Only unexpected transitions away from a healthy connection count as churn.
    // The connecting -> connected pair that follows each one is the recovery,
    // not a second fault, and a hidden-tab drop is Zero working as designed.
    const cutoff = now - CHURN_WINDOW_MS;
    let drops = 0;
    for (const event of this.connectionEvents.toArray()) {
      if (event.t < cutoff || event.name === 'connected' || event.name === 'connecting') continue;
      if (isHiddenTabDisconnect(event.reason)) continue;
      drops += 1;
    }

    const windowMs = Math.min(observed, CHURN_WINDOW_MS);
    if (windowMs >= MIN_CHURN_OBSERVATION_MS) {
      this.record('zeroDisconnectsPerHour', drops / (windowMs / 3_600_000), now);
    }
    this.invalidate();
  }

  setCpuContext(next: Partial<CpuContext>): void {
    this.cpu = { ...this.cpu, ...next };
    if (next.appCpuPercent !== null && next.appCpuPercent !== undefined) {
      this.record('cpuPercent', next.appCpuPercent);
    }
    if (next.appSharePercent !== null && next.appSharePercent !== undefined) {
      this.record('cpuSharePercent', next.appSharePercent);
    }
    this.invalidate();
  }

  setDevice(info: DeviceInfo): void {
    this.device = info;
    this.invalidate();
  }

  setAppVersion(version: string): void {
    if (!this.device || this.device.appVersion === version) return;
    this.device = { ...this.device, appVersion: version };
    this.invalidate();
  }

  /** Records CPU measured while the user was idle, which is the battery-relevant part. */
  recordIdleCpu(percent: number): void {
    this.record('idleCpuPercent', percent);
  }

  /** Per-process detail. Aggregate CPU arrives separately via `setCpuContext`. */
  setElectronProcesses(samples: ElectronProcessSample[]): void {
    this.runWindow?.push({ kind: 'processes', t: Date.now(), samples });
    this.electron = samples;
    this.record(
      'rssMb',
      samples.reduce((sum, p) => sum + p.workingSetMb, 0),
    );
  }

  /**
   * Folds buckets recovered from IndexedDB into the retained series. Buckets
   * this session already recorded win, since they were measured here rather
   * than restored.
   */
  hydrate(persisted: Partial<Record<MetricKey, Point[]>>): void {
    let earliest: number | null = null;
    const cutoff = Date.now() - HISTORY_RETENTION_MS;

    for (const [key, points] of Object.entries(persisted) as [MetricKey, Point[]][]) {
      if (!points?.length) continue;

      const merged = new Map<number, number>();
      for (const point of points) {
        if (point.t >= cutoff) merged.set(point.t, point.v);
      }
      for (const point of this.history.get(key) ?? []) merged.set(point.t, point.v);

      const combined = [...merged.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([t, v]) => ({ t, v }));
      this.history.set(key, combined);

      const first = combined[0];
      if (first && (earliest === null || first.t < earliest)) earliest = first.t;
    }

    this.historyFrom = earliest;
    this.invalidate();
  }

  reset(): void {
    this.series.clear();
    this.history.clear();
    this.latest.clear();
    this.latencySamples.clear();
    this.longTasks.clear();
    this.scripts.clear();
    this.api.clear();
    this.zeroQueries.clear();
    this.zeroMutations.clear();
    this.connectionEvents.clear();
    this.connectionCurrent = 'unknown';
    this.connectionReason = '';
    this.connectionObservingSince = null;
    this.connectionOfflineMs = 0;
    this.connectionStateSince = 0;
    this.cpu = EMPTY_CPU;
    this.electron = null;
    this.historyFrom = null;
    this.invalidate();
  }

  // ── Run windows ──────────────────────────────────────────────────────────

  /**
   * Attaches a run window. Only one run is meaningful at a time: two overlapping
   * windows would each measure the other's probe load, so starting a second one
   * closes the first rather than fanning out to both.
   */
  beginRunWindow(window: RunWindow): void {
    this.runWindow?.close();
    this.runWindow = window;
  }

  endRunWindow(at: number = Date.now()): void {
    this.runWindow?.close(at);
    this.runWindow = null;
  }

  hasActiveRunWindow(): boolean {
    return this.runWindow !== null;
  }

  private pushZeroOpEvent(
    op: 'query' | 'mutation',
    name: string,
    durationMs: number | null,
    error: boolean,
  ): void {
    this.runWindow?.push({ kind: 'zeroOp', t: Date.now(), op, name, durationMs, error });
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DiagnosticsSnapshot => {
    if (!this.cached) this.cached = this.build();
    return this.cached;
  };

  private build(): DiagnosticsSnapshot {
    const metrics = {} as Record<MetricKey, MetricState>;
    const verdicts: Verdict[] = [];

    for (const key of METRIC_KEYS) {
      const value = this.latest.get(key) ?? null;
      const verdict = verdictFor(key, value);
      const reason = this.unsupported.get(key);
      metrics[key] = {
        key,
        value,
        verdict,
        points: this.series.get(key)?.toArray() ?? [],
        historyPoints: this.history.get(key) ?? [],
        supported: reason === undefined,
        ...(reason === undefined ? {} : { unsupportedReason: reason }),
      };
      // CPU pressure describes the whole machine, so a busy laptop should not
      // make Xyne itself read as unhealthy. It is shown, but not scored.
      if (key !== 'cpuPressure') verdicts.push(verdict);
    }

    const scripts: ScriptDrain[] = [...this.scripts.values()]
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 20);

    const api: ApiDrain[] = [...this.api.values()]
      .map(row => ({
        endpoint: row.endpoint,
        count: row.count,
        totalMs: row.totalMs,
        p95Ms: percentile(row.durations, 95) ?? 0,
        transferKb: row.transferBytes / 1024,
      }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 20);

    return {
      startedAt: this.startedAt,
      updatedAt: Date.now(),
      historyFrom: this.historyFrom,
      metrics,
      scripts,
      api,
      longTaskCount: this.longTasks.size,
      zeroQueries: buildZeroOpStats(this.zeroQueries, 'zeroQueryP95'),
      zeroMutations: buildZeroOpStats(this.zeroMutations, 'zeroMutationP95'),
      zeroConnection: this.buildConnectionHealth(),
      cpu: this.cpu,
      idleForSeconds: Math.round(this.idleForMs() / 1000),
      device: this.device ?? FALLBACK_DEVICE,
      electron: this.electron,
      overall: worstVerdict(verdicts),
    };
  }

  private buildConnectionHealth(): ZeroConnectionHealth {
    if (this.connectionObservingSince === null) return EMPTY_ZERO_CONNECTION;

    const events = this.connectionEvents.toArray();
    const cutoff = Date.now() - CHURN_WINDOW_MS;
    const reasons = new Map<string, number>();
    let disconnects = 0;
    let hiddenDisconnects = 0;

    for (const event of events) {
      if (event.t < cutoff || event.name === 'connected' || event.name === 'connecting') continue;
      if (isHiddenTabDisconnect(event.reason)) {
        hiddenDisconnects += 1;
        continue;
      }
      disconnects += 1;
      const label = event.reason || event.name;
      reasons.set(label, (reasons.get(label) ?? 0) + 1);
    }

    return {
      current: this.connectionCurrent,
      currentReason: this.connectionReason,
      observingSince: this.connectionObservingSince,
      disconnects,
      hiddenDisconnects,
      recent: [...events].reverse().slice(0, 12),
      reasons: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private evictSmallest(map: Map<string, { totalMs: number }>): void {
    let smallestKey: string | null = null;
    let smallest = Infinity;
    for (const [key, row] of map) {
      if (row.totalMs < smallest) {
        smallest = row.totalMs;
        smallestKey = key;
      }
    }
    if (smallestKey !== null) map.delete(smallestKey);
  }

  private invalidate(): void {
    this.cached = null;
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const listener of this.listeners) listener();
    }, NOTIFY_INTERVAL_MS);
  }

  /**
   * The retained minute buckets, for the persistence layer. Already downsampled,
   * so a flush never has to walk the raw samples.
   */
  exportSeries(): Partial<Record<MetricKey, Point[]>> {
    const out: Partial<Record<MetricKey, Point[]>> = {};
    for (const [key, points] of this.history) out[key] = [...points];
    return out;
  }
}

/**
 * Turns the raw accumulators into sorted, individually-scored rows. Each row is
 * graded against the same threshold as the headline tile, so one slow query is
 * flagged even when the overall p95 still looks acceptable.
 */
function buildZeroOpStats(
  map: Map<string, ZeroOpAccumulator>,
  key: 'zeroQueryP95' | 'zeroMutationP95',
): ZeroOpStat[] {
  return [...map.values()]
    .map(row => {
      const p95 = percentile(row.durations, 95) ?? 0;
      return {
        name: row.name,
        count: row.count,
        p50Ms: percentile(row.durations, 50) ?? 0,
        p95Ms: p95,
        maxMs: row.maxMs,
        errors: row.errors,
        verdict: row.errors > 0 ? 'bad' : verdictFor(key, row.durations.length ? p95 : null),
      } satisfies ZeroOpStat;
    })
    .sort((a, b) => b.p95Ms - a.p95Ms)
    .slice(0, 25);
}

/** Drops the least-used row when the table is full, keeping the busy ones. */
function evictFewestCalls(map: Map<string, ZeroOpAccumulator>): void {
  let fewestKey: string | null = null;
  let fewest = Infinity;
  for (const [key, row] of map) {
    const calls = row.count + row.errors;
    if (calls < fewest) {
      fewest = calls;
      fewestKey = key;
    }
  }
  if (fewestKey !== null) map.delete(fewestKey);
}

const FALLBACK_DEVICE: DeviceInfo = {
  platform: 'unknown',
  userAgent: '',
  hardwareConcurrency: null,
  deviceMemoryGb: null,
  screen: '',
  dpr: 1,
  connection: null,
  crossOriginIsolated: false,
  appVersion: null,
  deviceId: null,
};

export const diagnosticsStore = new DiagnosticsStore();
