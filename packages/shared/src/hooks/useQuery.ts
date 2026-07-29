import { useEffect, useMemo, useRef } from 'react';
import { useQuery as zeroUseQuery } from '@rocicorp/zero/react';
import type {
  DefaultSchema,
  BaseDefaultSchema,
  DefaultContext,
  BaseDefaultContext,
  PullRow,
  ReadonlyJSONValue,
  QueryRequest,
  Query,
  TTL,
} from '@rocicorp/zero';
import type { UseQueryOptions, QueryResult } from '@rocicorp/zero/react';
import { Event } from '../logger/events.js';
import { useInstrumentation } from './useZero.js';
import { useZeroFallbackConfig } from './ZeroFallbackContext.js';
import { useFallbackQuery } from './useFallbackQuery.js';
import { wasInterrupted } from './metricValidity.js';

/**
 * App-wide default TTL for queries that don't specify one. Zero's own default
 * is 5m; after unmount a query keeps a live zero-cache pipeline until its TTL
 * expires, so per-entity queries pile up server-side. Callers with a reason to
 * keep a query hot (shared context, frequent back-nav) pass an explicit ttl.
 */
export const DEFAULT_QUERY_TTL: TTL = '2m';

function withDefaultTTL(options?: UseQueryOptions | boolean): UseQueryOptions {
  if (typeof options === 'object' && options !== null) {
    return options.ttl !== undefined ? options : { ...options, ttl: DEFAULT_QUERY_TTL };
  }
  return { ttl: DEFAULT_QUERY_TTL };
}

/**
 * Walks a query result (array or singular) and returns the highest
 * `updatedAt | lastActivityAt | createdAt` it finds across all rows.
 * Returns 0 when no timestamps are present, which deterministically
 * yields to the other source rather than guessing.
 *
 * Used as a freshness signal in the SWR ladder: Zero can fire `complete`
 * from its persisted kv state (see `experimentalWatch({initialValuesInFirstDiff: true})`
 * in zero-client's queryManager), which means a fresh fallback HTTP result
 * may carry rows that are strictly newer than what Zero just emitted as
 * `complete`. Yielding to Zero unconditionally in that window causes the
 * cache to be overwritten with the older kv snapshot, producing a visible
 * "fresh → stale → fresh" flicker until IVM applies the next server diff.
 */
function maxFreshnessTimestamp(data: unknown): number {
  if (data == null) return 0;
  const rows = Array.isArray(data) ? data : [data];
  let max = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const v = r['updatedAt'] ?? r['lastActivityAt'] ?? r['createdAt'];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) || 0 : 0;
    if (n > max) max = n;
  }
  return max;
}

/**
 * Internal: routes query through Zero or fallback based on config.
 */
function useQueryWithFallback<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn> {
  const { fallbackEnabled, keepZeroAlongsideFallback, onZeroComplete } = useZeroFallbackConfig();

  const enabledOption = typeof options === 'object' ? options.enabled : options;
  const baseEnabled = enabledOption ?? true;

  // Zero stays subscribed while fallback is on only when the app has opted in
  // via `keepZeroAlongsideFallback`. Lotus opts in so its first-complete latch
  // can fire (the latch needs Zero to actually run to flip). Dashboard doesn't
  // opt in → Zero is disabled while fallback serves the page (original behavior,
  // no wasted parallel IVM hydration).
  const zeroEnabled = (keepZeroAlongsideFallback || !fallbackEnabled) && baseEnabled;

  const zeroResult = zeroUseQuery(query, {
    ...withDefaultTTL(options),
    enabled: zeroEnabled,
  });

  const fallbackResult = useFallbackQuery<TTable, TInput, TOutput, TSchema, TReturn, TContext>(
    query,
    typeof options === 'object'
      ? { ...options, enabled: fallbackEnabled && baseEnabled }
      : fallbackEnabled && baseEnabled,
  );

  // Notify the app's "Zero is ready" signal the first time Zero delivers any
  // query result. No-op when the app doesn't supply onZeroComplete.
  const zeroDetailsType = zeroResult[1].type;
  useEffect(() => {
    if (zeroDetailsType === 'complete') {
      onZeroComplete?.();
    }
  }, [zeroDetailsType, onZeroComplete]);

  // SWR handoff between fallback and Zero. When `keepZeroAlongsideFallback`
  // is opted in (lotus), Zero stays subscribed alongside fallback so the
  // first-complete latch can flip. The handoff handles two known races:
  //
  // 1. Latch flips before Zero has confirmed THIS query → Zero is unknown,
  //    return fallback (stale-while-revalidate, prevents empty flash).
  // 2. Zero emits `complete` from its persisted kv `got` state (the standard
  //    Zero behavior — see queryManager's experimentalWatch with
  //    initialValuesInFirstDiff: true) but the snapshot it carries predates
  //    a recent postgres mutation that fallback DID capture. Returning Zero
  //    here would overwrite the fresher fallback rows in queryCacheActor
  //    until IVM applies the next server diff (typically seconds), producing
  //    a visible fresh→stale→fresh flicker. Guard by comparing the max
  //    timestamp across rows and yielding only when Zero is at least as
  //    fresh.
  if (fallbackEnabled) return fallbackResult;
  if (!keepZeroAlongsideFallback) return zeroResult;
  if (zeroResult[1].type === 'complete') {
    if (fallbackResult[1].type === 'complete') {
      const zMax = maxFreshnessTimestamp(zeroResult[0]);
      const fMax = maxFreshnessTimestamp(fallbackResult[0]);
      if (zMax >= fMax) return zeroResult;
      return fallbackResult;
    }
    return zeroResult;
  }
  if (fallbackResult[1].type === 'complete') return fallbackResult;
  return zeroResult;
}

/**
 * Shared useQuery with instrumentation and fallback support.
 * Both dashboard and lotus use this implementation.
 */
export function useQuery<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn> {
  const { logger, metrics } = useInstrumentation();
  const queryName = query.query.queryName || 'unknown';
  const args = query.args;

  const argsKey = useMemo(() => JSON.stringify(args), [args]);
  const startTime = useMemo(() => performance.now(), [queryName, argsKey]);
  const hasLoggedCompleteRef = useRef(false);
  const isEnabled = typeof options === 'boolean' ? options : options?.enabled !== false;

  useEffect(() => {
    if (!isEnabled) return;
    hasLoggedCompleteRef.current = false;
    logger.info(Event.ZERO_QUERY_CALLED, { query: queryName, args: query.args });
    metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'start' });
  }, [queryName, argsKey, isEnabled]);

  const result = useQueryWithFallback(query, options);
  const [data, details] = result;

  useEffect(() => {
    if (details.type === 'complete' && !hasLoggedCompleteRef.current) {
      hasLoggedCompleteRef.current = true;
      const latency = performance.now() - startTime;
      const skewed = wasInterrupted(startTime);
      if (!skewed) {
        metrics.recordLatency('zero.query.latency', latency, { query: queryName });
      }
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'success' });
      const rowCount = Array.isArray(data) ? data.length : data != null ? 1 : 0;
      logger.info(Event.ZERO_QUERY_COMPLETE, { query: queryName, latency, args, skewed, rowCount });
    } else if (details.type === 'error') {
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'error' });
      logger.error(Event.ZERO_QUERY_FAILED, { query: queryName, error: details.error });
    }
  }, [data, details, queryName]);

  return result;
}

/**
 * useRawQuery for raw Query objects (not QueryRequest).
 * Requires explicit queryName for logging/metrics.
 */
export function useRawQuery<
  TTable extends keyof TSchema['tables'] & string,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
>(
  query: Query<TTable, TSchema, TReturn>,
  queryName: string,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn> {
  const { logger, metrics } = useInstrumentation();

  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const startTime = useMemo(() => performance.now(), [queryName, queryKey]);
  const hasLoggedCompleteRef = useRef(false);

  useEffect(() => {
    hasLoggedCompleteRef.current = false;
    logger.info(Event.ZERO_QUERY_CALLED, { query: queryName });
    metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'start' });
  }, [queryName, queryKey]);

  const result = zeroUseQuery(query, withDefaultTTL(options));
  const [data, details] = result;

  useEffect(() => {
    if (details.type === 'complete' && !hasLoggedCompleteRef.current) {
      hasLoggedCompleteRef.current = true;
      const latency = performance.now() - startTime;
      const skewed = wasInterrupted(startTime);
      if (!skewed) {
        metrics.recordLatency('zero.query.latency', latency, { query: queryName });
      }
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'success' });
      const rowCount = Array.isArray(data) ? data.length : data != null ? 1 : 0;
      logger.info(Event.ZERO_QUERY_COMPLETE, { query: queryName, latency, skewed, rowCount });
    } else if (details.type === 'error') {
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'error' });
      logger.error(Event.ZERO_QUERY_FAILED, { query: queryName, error: details.error });
    }
  }, [data, details, queryName]);

  return result;
}
