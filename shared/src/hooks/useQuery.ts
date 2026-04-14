import { useEffect, useMemo } from 'react';
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
} from '@rocicorp/zero';
import type { UseQueryOptions, QueryResult } from '@rocicorp/zero/react';
import { Event } from '../logger/events.js';
import { useInstrumentation } from './useZero.js';
import { useZeroFallbackConfig } from './ZeroFallbackContext.js';
import { useFallbackQuery } from './useFallbackQuery.js';

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

  const zeroResult = zeroUseQuery(
    query,
    typeof options === 'object'
      ? { ...options, enabled: !fallbackEnabled && baseEnabled }
      : !fallbackEnabled && baseEnabled,
  );

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

  const startTime = useMemo(() => performance.now(), [queryName, JSON.stringify(args)]);

  useEffect(() => {
    logger.info(Event.ZERO_QUERY_CALLED, { query: queryName, args: query.args });
    metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'start' });
  }, [queryName, JSON.stringify(args)]);

  const result = useQueryWithFallback(query, options);
  const [data, details] = result;

  useEffect(() => {
    if (details.type === 'complete') {
      const latency = performance.now() - startTime;
      metrics.recordLatency('zero.query.latency', latency, { query: queryName });
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'success' });
      logger.info(Event.ZERO_QUERY_COMPLETE, { query: queryName, latency, args });
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

  const startTime = useMemo(() => performance.now(), [queryName, JSON.stringify(query)]);

  useEffect(() => {
    logger.info(Event.ZERO_QUERY_CALLED, { query: queryName });
    metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'start' });
  }, [queryName, JSON.stringify(query)]);

  const result = zeroUseQuery(query, options);
  const [data, details] = result;

  useEffect(() => {
    if (details.type === 'complete') {
      const latency = performance.now() - startTime;
      metrics.recordLatency('zero.query.latency', latency, { query: queryName });
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'success' });
      logger.info(Event.ZERO_QUERY_COMPLETE, { query: queryName, latency });
    } else if (details.type === 'error') {
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'error' });
      logger.error(Event.ZERO_QUERY_FAILED, { query: queryName, error: details.error });
    }
  }, [data, details, queryName, JSON.stringify(query)]);

  return result;
}
