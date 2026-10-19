/**
 * Data layer for the v3 metrics page: a module-level request cache (60 s fresh, in-flight dedupe,
 * previous data kept while a new key loads) plus one hook per endpoint, all `(scope, params, { enabled })`.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ApiError,
  backfillToolStats,
  fetchMetricSessions,
  fetchMetricsActiveAgents,
  fetchMetricsAgentsTop,
  fetchMetricsCitations,
  fetchMetricsErrorClasses,
  fetchMetricsLlmCalls,
  fetchMetricsRoutes,
  fetchMetricsRunDaily,
  fetchMetricsSentiment,
  fetchMetricsSummary,
  fetchMetricsTools,
  fetchMetricsUnusedGrants,
  metricSessionsParams,
  metricsUrl,
  type ActiveAgentsResponse,
  type AdminOrgScope,
  type AgentsTopResponse,
  type CitationsResponse,
  type ErrorClassesRequest,
  type ErrorClassesResponse,
  type LlmCallsResponse,
  type MetricsDays,
  type MetricSessionsRequest,
  type MetricSessionsResponse,
  type RoutesResponse,
  type RunDailyResponse,
  type SentimentResponse,
  type SummaryResponse,
  type ToolsRequest,
  type ToolsResponse,
  type UnusedGrantsResponse,
} from "../../lib/api";

export type { MetricsDays };

/** The filter context of the whole page; panels pass it straight to the hooks. */
export interface MetricsScopeParams {
  userId: string;
  days: MetricsDays;
  orgScope: AdminOrgScope;
  agentSlugs: string[];
  tz: string;
  isAdmin: boolean;
}

export interface MetricsHookOptions {
  /** False = no request and no subscription. Defaults to true. */
  enabled?: boolean;
}

/** No params for this endpoint; `{}` and `undefined` are equivalent. */
export type NoParams = Record<string, never> | undefined;

export interface MetricState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  /** HTTP status of the last failure, when it came from the server (400 = bad cursor, …). */
  errorStatus: number | null;
  /** True while `data` belongs to an earlier key and the current key is still loading. */
  isPlaceholder: boolean;
  /** Bypass the 60 s freshness window and fetch again. */
  refetch: () => void;
}

export const METRICS_FRESH_MS = 60_000;
const MAX_ENTRIES = 300;

interface CacheError {
  message: string;
  status: number | null;
}

interface CacheEntry {
  key: string;
  /** Endpoint path below /metrics, e.g. "/tools/error-classes" — what invalidation matches. */
  path: string;
  data: unknown;
  hasData: boolean;
  at: number;
  error: CacheError | null;
  promise: Promise<void> | null;
  ctrl: AbortController | null;
  subscribers: number;
  listeners: Set<() => void>;
  load: ((signal: AbortSignal) => Promise<unknown>) | null;
}

const entries = new Map<string, CacheEntry>();

function pathOf(url: string): string {
  const at = url.indexOf("/metrics");
  const tail = at >= 0 ? url.slice(at + "/metrics".length) : url;
  const q = tail.indexOf("?");
  return q >= 0 ? tail.slice(0, q) : tail;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function toCacheError(err: unknown): CacheError {
  if (err instanceof ApiError) return { message: err.message, status: err.status };
  return { message: err instanceof Error ? err.message : String(err), status: null };
}

function evictIdle(): void {
  if (entries.size <= MAX_ENTRIES) return;
  const idle = [...entries.values()]
    .filter((e) => e.subscribers === 0 && e.promise === null)
    .sort((a, b) => a.at - b.at);
  for (const e of idle) {
    if (entries.size <= MAX_ENTRIES) break;
    entries.delete(e.key);
  }
}

function entryFor(key: string, path: string): CacheEntry {
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      key,
      path,
      data: undefined,
      hasData: false,
      at: 0,
      error: null,
      promise: null,
      ctrl: null,
      subscribers: 0,
      listeners: new Set(),
      load: null,
    };
    entries.set(key, entry);
    evictIdle();
  }
  return entry;
}

function notify(entry: CacheEntry): void {
  for (const listener of [...entry.listeners]) listener();
}

function isFresh(entry: CacheEntry): boolean {
  return entry.hasData && Date.now() - entry.at < METRICS_FRESH_MS;
}

function startFetch(entry: CacheEntry): void {
  if (entry.promise || !entry.load) return;
  const ctrl = new AbortController();
  entry.ctrl = ctrl;
  entry.error = null;
  entry.promise = entry
    .load(ctrl.signal)
    .then(
      (data) => {
        entry.data = data;
        entry.hasData = true;
        entry.at = Date.now();
        entry.error = null;
      },
      (err: unknown) => {
        if (ctrl.signal.aborted || isAbort(err)) return;
        entry.error = toCacheError(err);
      },
    )
    .finally(() => {
      if (entry.ctrl === ctrl) {
        entry.promise = null;
        entry.ctrl = null;
      }
      if (ctrl.signal.aborted && !entry.hasData && entry.subscribers === 0) entries.delete(entry.key);
      notify(entry);
    });
  notify(entry);
}

function release(entry: CacheEntry): void {
  entry.subscribers = Math.max(0, entry.subscribers - 1);
  if (entry.subscribers > 0) return;
  setTimeout(() => {
    if (entry.subscribers > 0 || !entry.ctrl) return;
    entry.ctrl.abort();
    entry.ctrl = null;
    entry.promise = null;
  }, 0);
}

/** The cache for code outside the hooks. */
export const metricsCache = {
  peek<T>(key: string): T | undefined {
    const entry = entries.get(key);
    return entry && isFresh(entry) ? (entry.data as T) : undefined;
  },
  /** No-op when fresh or in flight. */
  prefetch<T>(key: string, url: string, load: (signal: AbortSignal) => Promise<T>): void {
    const entry = entryFor(key, pathOf(url));
    if (isFresh(entry) || entry.promise) return;
    entry.load = load;
    startFetch(entry);
  },
  /** One-off read as a promise: fresh data resolves at once, an in-flight request is joined. */
  get<T>(key: string, url: string, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const entry = entryFor(key, pathOf(url));
    if (isFresh(entry)) return Promise.resolve(entry.data as T);
    if (!entry.promise) {
      entry.load = load;
      startFetch(entry);
    }
    const pending = entry.promise ?? Promise.resolve();
    return pending.then(() => {
      if (entry.hasData && !entry.error) return entry.data as T;
      throw new Error(entry.error?.message ?? "Request was cancelled");
    });
  },
};

/** Marks entries whose path starts with `prefix` (none = all) stale, refetches shown ones, drops idle ones. */
export function invalidateMetrics(prefix?: string): void {
  for (const entry of [...entries.values()]) {
    if (prefix && !entry.path.startsWith(prefix)) continue;
    entry.at = 0;
    if (entry.subscribers > 0) {
      if (!entry.promise) startFetch(entry);
    } else if (!entry.promise) {
      entries.delete(entry.key);
    }
  }
}

interface LocalState {
  key: string | null;
  data: unknown;
  dataKey: string | null;
  loading: boolean;
  error: CacheError | null;
}

function readEntry(entry: CacheEntry, prev: LocalState): LocalState {
  const loading = entry.promise !== null || (!entry.hasData && entry.error === null);
  if (entry.hasData) {
    return { key: entry.key, data: entry.data, dataKey: entry.key, loading, error: loading ? null : entry.error };
  }
  // Keep the previous key's data while this one loads; drop it once this key fails.
  const failed = !loading && entry.error !== null;
  return {
    key: entry.key,
    data: failed ? undefined : prev.data,
    dataKey: failed ? null : prev.dataKey,
    loading,
    error: loading ? null : entry.error,
  };
}

/** The hook every endpoint hook wraps. `key` null = disabled; only the key drives fetching, `load` is held in a ref. */
export function useMetricsResource<T>(
  key: string | null,
  url: string,
  load: (signal: AbortSignal) => Promise<T>,
): MetricState<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [nonce, setNonce] = useState(0);

  const [state, setState] = useState<LocalState>(() => {
    const entry = key ? entries.get(key) : undefined;
    return entry?.hasData
      ? { key, data: entry.data, dataKey: key, loading: !isFresh(entry), error: null }
      : { key, data: undefined, dataKey: null, loading: key !== null, error: null };
  });

  useEffect(() => {
    if (key === null) {
      setState((prev) => (prev.loading || prev.error ? { ...prev, loading: false, error: null } : prev));
      return;
    }
    const entry = entryFor(key, pathOf(url));
    entry.subscribers += 1;
    entry.load = (signal) => loadRef.current(signal);
    const sync = (): void => setState((prev) => readEntry(entry, prev));
    entry.listeners.add(sync);
    if (!isFresh(entry)) startFetch(entry);
    sync();
    return () => {
      entry.listeners.delete(sync);
      release(entry);
    };
    // `url` derives from `key`; `nonce` re-runs this after refetch().
  }, [key, nonce]);

  const refetch = useCallback(() => {
    if (key === null) return;
    const entry = entries.get(key);
    if (entry) entry.at = 0;
    setNonce((n) => n + 1);
  }, [key]);

  const current = state.key === key;
  return {
    data: state.data as T | undefined,
    loading: key !== null && (!current || state.loading),
    error: current ? (state.error?.message ?? null) : null,
    errorStatus: current ? (state.error?.status ?? null) : null,
    isPlaceholder: state.data !== undefined && state.dataKey !== key,
    refetch,
  };
}

function cacheKey(userId: string, url: string): string {
  return `${userId} ${url}`;
}

function v2Hook<T>(
  scope: MetricsScopeParams,
  url: string,
  enabled: boolean,
  load: (signal: AbortSignal) => Promise<T>,
): MetricState<T> {
  const on = enabled && scope.userId !== "";
  return useMetricsResource(on ? cacheKey(scope.userId, url) : null, url, load);
}

export function useSummary(
  scope: MetricsScopeParams,
  _params?: NoParams,
  opts: MetricsHookOptions = {},
): MetricState<SummaryResponse> {
  const url = metricsUrl("/summary", scope);
  return v2Hook(scope, url, opts.enabled ?? true, (signal) => fetchMetricsSummary(scope, signal));
}

export function useRunDaily(
  scope: MetricsScopeParams,
  _params?: NoParams,
  opts: MetricsHookOptions = {},
): MetricState<RunDailyResponse> {
  const url = metricsUrl("/runs/daily", scope, { tz: scope.tz });
  return v2Hook(scope, url, opts.enabled ?? true, (signal) => fetchMetricsRunDaily(scope, scope.tz, signal));
}

export function useAgentsTop(
  scope: MetricsScopeParams,
  params: { limit?: number } = {},
  opts: MetricsHookOptions = {},
): MetricState<AgentsTopResponse> {
  const limit = params.limit ?? 20;
  const url = metricsUrl("/agents/top", scope, { limit });
  return v2Hook(scope, url, opts.enabled ?? true, (signal) => fetchMetricsAgentsTop(scope, limit, signal));
}

/** Agents active in the last 30 days for the picker; ignores the page range and agent filter. */
export function useActiveAgents(
  scope: MetricsScopeParams,
  _params?: NoParams,
  opts: MetricsHookOptions = {},
): MetricState<ActiveAgentsResponse> {
  const url = metricsUrl("/agents/active", { ...scope, days: 30, agentSlugs: [] });
  return v2Hook(scope, url, opts.enabled ?? true, (signal) => fetchMetricsActiveAgents(scope, signal));
}

export function useRoutes(
  scope: MetricsScopeParams,
  _params?: NoParams,
  opts: MetricsHookOptions = {},
): MetricState<RoutesResponse> {
  const url = metricsUrl("/routes", scope);
  return v2Hook(scope, url, opts.enabled ?? true, (signal) => fetchMetricsRoutes(scope, signal));
}

/** Disabled unless exactly one agent is selected — the endpoint is per-agent. */
export function useSentiment(
  scope: MetricsScopeParams,
  _params?: NoParams,
  opts: MetricsHookOptions = {},
): MetricState<SentimentResponse> {
  const url = metricsUrl("/sentiment", scope);
  const enabled = (opts.enabled ?? true) && scope.agentSlugs.length === 1;
  return v2Hook(scope, url, enabled, (signal) => fetchMetricsSentiment(scope, signal));
}

export function useMetricSessions(
  scope: MetricsScopeParams,
  params: MetricSessionsRequest,
  opts: MetricsHookOptions = {},
): MetricState<MetricSessionsResponse> {
  const url = metricsUrl("/sessions", scope, metricSessionsParams(params));
  return v2Hook(scope, url, opts.enabled ?? true, (signal) => fetchMetricSessions(scope, params, signal));
}

/** Warms the cache for a sessions page without subscribing. */
export function prefetchMetricSessions(scope: MetricsScopeParams, params: MetricSessionsRequest): void {
  if (!scope.userId) return;
  const url = metricsUrl("/sessions", scope, metricSessionsParams(params));
  metricsCache.prefetch(cacheKey(scope.userId, url), url, (signal) => fetchMetricSessions(scope, params, signal));
}

function toolsUrl(scope: MetricsScopeParams, params: ToolsRequest): string {
  return metricsUrl("/tools", scope, {
    sort: params.sort,
    dir: params.dir,
    limit: params.limit,
    offset: params.offset,
    search: params.search,
  });
}

export function useTools(
  scope: MetricsScopeParams,
  params: ToolsRequest = {},
  opts: MetricsHookOptions = {},
): MetricState<ToolsResponse> {
  return v2Hook(scope, toolsUrl(scope, params), opts.enabled ?? true, (signal) => fetchMetricsTools(scope, params, signal));
}

/** One /tools answer as a promise through metricsCache, for click handlers. */
export function loadTools(scope: MetricsScopeParams, params: ToolsRequest): Promise<ToolsResponse> {
  if (!scope.userId) return Promise.reject(new Error("No viewer yet"));
  const url = toolsUrl(scope, params);
  return metricsCache.get(cacheKey(scope.userId, url), url, (signal) => fetchMetricsTools(scope, params, signal));
}

export function useErrorClasses(
  scope: MetricsScopeParams,
  params: ErrorClassesRequest = {},
  opts: MetricsHookOptions = {},
): MetricState<ErrorClassesResponse> {
  const url = metricsUrl("/tools/error-classes", scope, {
    tool: params.tool,
    limit: params.limit,
    offset: params.offset,
    perTool: params.perTool,
  });
  return v2Hook(scope, url, opts.enabled ?? true, (signal) => fetchMetricsErrorClasses(scope, params, signal));
}

export function useCitations(
  scope: MetricsScopeParams,
  params: { exact?: boolean } = {},
  opts: MetricsHookOptions = {},
): MetricState<CitationsResponse> {
  const url = metricsUrl("/tools/citations", scope, { exact: params.exact });
  return v2Hook(scope, url, opts.enabled ?? true, (signal) => fetchMetricsCitations(scope, params, signal));
}

export function useUnusedGrants(
  scope: MetricsScopeParams,
  _params?: NoParams,
  opts: MetricsHookOptions = {},
): MetricState<UnusedGrantsResponse> {
  const url = metricsUrl("/tools/unused-grants", scope);
  return v2Hook(scope, url, opts.enabled ?? true, (signal) => fetchMetricsUnusedGrants(scope, signal));
}

export function useLlmCalls(
  scope: MetricsScopeParams,
  params: { includeSubagents?: boolean } = {},
  opts: MetricsHookOptions = {},
): MetricState<LlmCallsResponse> {
  const url = metricsUrl("/llm-calls", scope, { includeSubagents: params.includeSubagents });
  return v2Hook(scope, url, opts.enabled ?? true, (signal) => fetchMetricsLlmCalls(scope, params, signal));
}

export interface ToolStatsBackfill {
  running: boolean;
  error: string | null;
  remaining: number | null;
  run: () => void;
}

/** Runs per request, to stay under gateway timeouts. */
const BACKFILL_SLICE = 5000;

// One backfill per page, shared by every panel that shows the button.
let backfillState: Omit<ToolStatsBackfill, "run"> = { running: false, error: null, remaining: null };
const backfillListeners = new Set<() => void>();

function setBackfill(next: Partial<Omit<ToolStatsBackfill, "run">>): void {
  backfillState = { ...backfillState, ...next };
  backfillListeners.forEach((listener) => listener());
}

async function runBackfill(userId: string): Promise<void> {
  setBackfill({ running: true, error: null });
  try {
    let previous = Number.POSITIVE_INFINITY;
    for (;;) {
      const report = await backfillToolStats(userId, { maxRows: BACKFILL_SLICE });
      const remaining = report.remaining ?? 0;
      setBackfill({ remaining });
      // Stop when done, or when a slice made no progress (its runs keep failing).
      if (remaining === 0 || report.scanned === 0 || remaining >= previous) break;
      previous = remaining;
    }
  } catch (err) {
    setBackfill({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    setBackfill({ running: false });
    invalidateMetrics();
  }
}

function subscribeBackfill(listener: () => void): () => void {
  backfillListeners.add(listener);
  return () => backfillListeners.delete(listener);
}

/** Admin action behind `BackfillAction`: slices until no run is left, then refetches every card. */
export function useToolStatsBackfill(userId: string): ToolStatsBackfill {
  const state = useSyncExternalStore(subscribeBackfill, () => backfillState);
  const run = useCallback(() => {
    if (userId && !backfillState.running) void runBackfill(userId);
  }, [userId]);
  return { ...state, run };
}
