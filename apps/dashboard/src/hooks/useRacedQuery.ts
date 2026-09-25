import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery as useApiQuery } from '@tanstack/react-query';
import { useFallbackExecutor } from '@xyne/shared/hooks';
import type { UseCachedQueryOptions, CachedQueryResult } from '@xyne/shared/hooks';
import type { QueryResult } from '@rocicorp/zero/react';
import type {
  QueryRequest,
  BaseDefaultSchema,
  DefaultSchema,
  BaseDefaultContext,
  DefaultContext,
  PullRow,
  ReadonlyJSONValue,
} from '@rocicorp/zero';
import { useCachedQuery } from './useCachedQuery';
import { logger, Event } from '../utils/logger';

export type RacedQuerySource = 'cache' | 'api' | 'zero';

export interface RacedQueryMeta {
  source: RacedQuerySource;
  live: boolean;
}

export type RacedQueryResult<TReturn> = readonly [
  QueryResult<TReturn>[0],
  QueryResult<TReturn>[1],
  RacedQueryMeta,
];

const COMPLETE = { type: 'complete' } as const;

export function useRacedQuery<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseCachedQueryOptions,
): RacedQueryResult<TReturn> {
  const enabled = options?.enabled ?? true;
  const executeFallback = useFallbackExecutor();

  const [cachedData, cachedDetails, meta] = useCachedQuery(query, {
    ...options,
    includeMeta: true,
  }) as CachedQueryResult<TReturn>;

  const zeroLive = meta.live;

  const queryName = query.query.queryName || 'unknown';
  const args = query.args;
  const argsKey = useMemo(() => JSON.stringify(args ?? null), [args]);

  const latchedArgsRef = useRef<string | null>(null);
  const [zeroWon, setZeroWon] = useState(false);

  useEffect(() => {
    latchedArgsRef.current = null;
    setZeroWon(false);
  }, [argsKey]);

  useEffect(() => {
    if (!zeroLive) return;
    if (latchedArgsRef.current === argsKey) return;
    latchedArgsRef.current = argsKey;
    setZeroWon(true);
  }, [zeroLive, argsKey]);

  const apiEnabled = enabled && !zeroWon && executeFallback !== null;

  const { data: apiData, isSuccess: apiSucceeded } = useApiQuery({
    queryKey: ['raced-query', queryName, argsKey],
    queryFn: () => executeFallback!(queryName, args),
    enabled: apiEnabled,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: 1,
  });

  const raceStartedAt = useRef(Date.now());
  useEffect(() => {
    raceStartedAt.current = Date.now();
  }, [argsKey]);

  const wonByRef = useRef<RacedQuerySource | null>(null);
  useEffect(() => {
    const winner: RacedQuerySource = zeroWon ? 'zero' : apiSucceeded ? 'api' : 'cache';
    if (wonByRef.current === winner) return;
    wonByRef.current = winner;
    if (winner === 'cache') return;
    const elapsedMs = Date.now() - raceStartedAt.current;
    logger.info(Event.ZERO_QUERY_COMPLETE, {
      source: 'useRacedQuery',
      query: queryName,
      winner,
      elapsedMs,
    });
  }, [zeroWon, apiSucceeded, queryName, argsKey]);

  if (zeroWon) {
    return [cachedData, cachedDetails, { source: 'zero', live: true }];
  }

  if (apiSucceeded && apiData !== undefined) {
    return [apiData as QueryResult<TReturn>[0], COMPLETE, { source: 'api', live: false }];
  }

  return [cachedData, cachedDetails, { source: 'cache', live: false }];
}
