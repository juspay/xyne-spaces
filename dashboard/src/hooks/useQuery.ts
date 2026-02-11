import { useEffect, useMemo } from 'react';
import { useQuery as zeroUseQuery } from '@rocicorp/zero/react';
import type {
  Schema,
  DefaultSchema,
  DefaultContext,
  PullRow,
  ReadonlyJSONValue,
  QueryRequest,
  Query,
} from '@rocicorp/zero';
import type { UseQueryOptions, QueryResult } from '@rocicorp/zero/react';
import { zeroQueryLatency, zeroQueryOperations, safeRecordMetric } from '../services/otel';
import { logger, Event } from '../utils/logger';

// useQuery for QueryRequest
// Automatically extracts query name from the QueryRequest

export function useQuery<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends Schema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext = DefaultContext,
>(
  query: QueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn> {
  const queryName = query.query.queryName || 'unknown';
  const args = query.args;

  const startTime = useMemo(() => performance.now(), [queryName, JSON.stringify(args)]);

  useEffect(() => {
    logger.info(Event.ZERO_QUERY_CALLED, { query: queryName, args: query.args });
    safeRecordMetric(() => {
      zeroQueryOperations.add(1, { query: queryName, stage: 'start' });
    });
  }, [queryName, JSON.stringify(args)]);

  const result = zeroUseQuery(query, options);
  const [data, details] = result;

  useEffect(() => {
    if (details.type === 'complete') {
      const latency = performance.now() - startTime;

      safeRecordMetric(() => {
        zeroQueryLatency.record(latency, { query: queryName });
        zeroQueryOperations.add(1, { query: queryName, stage: 'success' });
      });

      logger.info(Event.ZERO_QUERY_COMPLETE, { query: queryName, latency, args });
    } else if (details.type === 'error') {
      safeRecordMetric(() => {
        zeroQueryOperations.add(1, { query: queryName, stage: 'error' });
      });
      logger.error(Event.ZERO_QUERY_FAILED, { query: queryName, error: details.error });
    }
  }, [data, details, queryName]);

  return result;
}

// useQueryWithQuery for raw Query objects
// Requires explicit queryName argument for logging and metrics
export function useRawQuery<
  TTable extends keyof TSchema['tables'] & string,
  TSchema extends Schema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
>(
  query: Query<TTable, TSchema, TReturn>,
  queryName: string,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn> {
  const startTime = useMemo(() => performance.now(), [queryName, JSON.stringify(query)]);

  useEffect(() => {
    logger.info(Event.ZERO_QUERY_CALLED, { query: queryName });
    safeRecordMetric(() => {
      zeroQueryOperations.add(1, { query: queryName, stage: 'start' });
    });
  }, [queryName, JSON.stringify(query)]);

  const result = zeroUseQuery(query, options);
  const [data, details] = result;

  useEffect(() => {
    if (details.type === 'complete') {
      const latency = performance.now() - startTime;

      safeRecordMetric(() => {
        zeroQueryLatency.record(latency, { query: queryName });
        zeroQueryOperations.add(1, { query: queryName, stage: 'success' });
      });

      logger.info(Event.ZERO_QUERY_COMPLETE, { query: queryName, latency });
    } else if (details.type === 'error') {
      safeRecordMetric(() => {
        zeroQueryOperations.add(1, { query: queryName, stage: 'error' });
      });
      logger.error(Event.ZERO_QUERY_FAILED, { query: queryName, error: details.error });
    }
  }, [data, details, queryName, JSON.stringify(query)]);

  return result;
}
