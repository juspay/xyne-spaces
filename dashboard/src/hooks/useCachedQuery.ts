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
import { useSelector } from '@xstate/react';
import { useQuery } from './useQuery';
import { useZero } from './useZero';

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
  const zero = useZero();

  // Compute hash using the query's internal fn which returns a QueryImpl with hash()
  const hash = useMemo(() => {
    // Call the query's fn directly with context and args
    // This returns a QueryImpl that has the hash() method
    // @ts-expect-error - accessing internal query structure
    const queryImpl = query.query.fn({ ctx: zero.context, args: query.args });
    // The queryImpl has a hash() method that returns the AST-based hash
    // @ts-expect-error - hash() is part of QueryInternals, not public Query interface
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return queryImpl.hash() as string;
  }, [query, zero.context]);

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
    }
  }, [freshData, freshDetails, hash]);

  // Always return a valid tuple
  return cachedData ?? [freshData, freshDetails];
}
