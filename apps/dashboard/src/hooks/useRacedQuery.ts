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
  /** Which of the three stages produced the returned rows. */
  source: RacedQuerySource;
  /** True once Zero has reported `complete` for the current args in this mount. */
  live: boolean;
}

export type RacedQueryResult<TReturn> = readonly [
  QueryResult<TReturn>[0],
  QueryResult<TReturn>[1],
  RacedQueryMeta,
];

const COMPLETE = { type: 'complete' } as const;

/**
 * Races the backend REST execution of a Zero query against the Zero
 * subscription itself, and serves whichever is furthest along:
 *
 *   cache (instant, possibly stale) → api (fresh) → zero (live, authoritative)
 *
 * Each stage only ever replaces a strictly worse one, so the view never moves
 * backwards. Once Zero reports `complete` it owns the result for the rest of
 * the mount and the API call is disabled.
 *
 * The API leg goes through the same `/zero/query-fallback` executor the global
 * fallback uses, so the server runs the SAME query definition — identical ACL
 * and identical row shape, relations included. No per-query endpoint needed.
 *
 * Liveness comes from `useCachedQuery`'s `live` flag, not from `details.type`:
 * a persisted cache entry carries the `details` it was stored with, so a cached
 * result can claim `complete` while being a previous session's snapshot.
 */
export function useRacedQuery<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseCachedQueryOptions & { raceEnabled?: boolean },
): RacedQueryResult<TReturn> {
  const enabled = options?.enabled ?? true;
  // Lets callers keep the plain cached path for query variants that shouldn't
  // race — e.g. the ticket list's escalation rungs, where only the base page
  // is worth an HTTP round trip.
  const raceEnabled = options?.raceEnabled ?? true;
  const executeFallback = useFallbackExecutor();

  // includeMeta:true always yields the 3-tuple, but the declared return is a
  // union of both shapes, so the narrowing has to be asserted here.
  const [cachedData, cachedDetails, meta] = useCachedQuery(query, {
    ...options,
    includeMeta: true,
  }) as CachedQueryResult<TReturn>;

  const zeroLive = meta.live;

  const queryName = query.query.queryName || 'unknown';
  const args = query.args;
  const argsKey = useMemo(() => JSON.stringify(args ?? null), [args]);

  // The latch is keyed on args: a new page / new ticket is a new race, and must
  // not inherit the previous args' "Zero already won" state.
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

  const apiEnabled = enabled && raceEnabled && !zeroWon && executeFallback !== null;

  const { data: apiData, isSuccess: apiSucceeded } = useApiQuery({
    queryKey: ['raced-query', queryName, argsKey],
    queryFn: () => executeFallback!(queryName, args),
    enabled: apiEnabled,
    // One shot. The Zero subscription is the live channel; polling here would
    // duplicate it and keep hitting the read replica for the whole mount.
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: 1,
  });

  const wonByRef = useRef<RacedQuerySource | null>(null);
  useEffect(() => {
    const winner: RacedQuerySource = zeroWon ? 'zero' : apiSucceeded ? 'api' : 'cache';
    if (wonByRef.current === winner) return;
    wonByRef.current = winner;
    if (winner === 'cache') return;
    logger.info(Event.ZERO_QUERY_COMPLETE, {
      source: 'useRacedQuery',
      query: queryName,
      winner,
    });
  }, [zeroWon, apiSucceeded, queryName]);

  if (zeroWon) {
    return [cachedData, cachedDetails, { source: 'zero', live: true }];
  }

  if (apiSucceeded && apiData !== undefined) {
    return [apiData as QueryResult<TReturn>[0], COMPLETE, { source: 'api', live: false }];
  }

  return [cachedData, cachedDetails, { source: 'cache', live: false }];
}
