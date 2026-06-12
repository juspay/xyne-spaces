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
  const { fallbackEnabled } = useZeroFallbackConfig();

  const enabledOption = typeof options === 'object' ? options.enabled : options;
  const baseEnabled = enabledOption ?? true;

  const zeroResult = zeroUseQuery(query, {
    ...withDefaultTTL(options),
    enabled: !fallbackEnabled && baseEnabled,
  });

  const fallbackResult = useFallbackQuery<TTable, TInput, TOutput, TSchema, TReturn, TContext>(
    query,
    typeof options === 'object'
      ? { ...options, enabled: fallbackEnabled && baseEnabled }
      : fallbackEnabled && baseEnabled,
  );

  return fallbackEnabled ? fallbackResult : zeroResult;
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
