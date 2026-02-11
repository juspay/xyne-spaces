import { useEffect, useMemo } from 'react';
import type {
  QueryRequest,
  Schema,
  DefaultSchema,
  DefaultContext,
  PullRow,
  ReadonlyJSONValue,
} from '@rocicorp/zero';
import type { UseQueryOptions, QueryResult } from '@rocicorp/zero/react';
import { queryCacheActor } from '../machines/queryCacheMachine';
import { generateQueryHash } from '../utils/queryHash';
import { useSelector } from '@xstate/react';
import { useQuery } from './useQuery';

/**
 * useCachedQuery Hook
 *
 * Enhanced version of useQuery that caches results in XState.
 * Returns cached data immediately while fetching fresh data in the background.
 *
 * @param query - The query to execute (same as useQuery)
 * @param options - Query options (same as useQuery)
 * @returns QueryResult tuple [data, details] (same as useQuery)
 *
 * @example
 * ```tsx
 * const [users, details] = useCachedQuery(queries.getUsers());
 * ```
 */
export function useCachedQuery<
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
  // Extract query name and arguments
  const name = query.query.queryName;
  const args = query.args;

  const argsKey = useMemo(() => JSON.stringify(args), [args]);
  const hash = useMemo(() => generateQueryHash(name, args), [name, argsKey]);

  const cachedData = useSelector(queryCacheActor, state => {
    const entry = hash ? state.context.cache.get(hash) : undefined;
    return entry?.data;
  }) as QueryResult<TReturn> | undefined;

  const [freshData, freshDetails] = useQuery(query, options);

  useEffect(() => {
    if (freshDetails.type === 'complete' && hash) {
      queryCacheActor.send({
        type: 'SET_KEY',
        hash,
        data: [freshData, freshDetails],
      });
      queryCacheActor.send({ type: 'EVICT_STALE_ENTRIES' });
    }
  }, [freshData, freshDetails, hash]);

  // Always return a valid tuple
  return cachedData ?? [freshData, freshDetails];
}
