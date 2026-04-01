import { useEffect, useMemo, useRef } from 'react';
import type {
  QueryRequest,
  BaseDefaultSchema,
  DefaultSchema,
  BaseDefaultContext,
  DefaultContext,
  PullRow,
  ReadonlyJSONValue,
  TTL,
} from '@rocicorp/zero';
import type { UseQueryOptions, QueryResult } from '@rocicorp/zero/react';
import { queryCacheActor, type CacheEntry } from '../machines/queryCacheMachine';
import { useSelector } from '@xstate/react';
import { useQuery } from './useQuery';
import { useZero } from './useZero';
import { Event, logger } from '../utils/logger';

export interface UseCachedQueryOptions {
  ttl?: TTL | undefined;
  enabled?: boolean | undefined;
  updatedAtEnabled?: boolean;
}

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const shouldUpdateLastUpdatedAt = (currentLastUpdatedAt: number | undefined): boolean => {
  if (!currentLastUpdatedAt) return true;
  return Date.now() - currentLastUpdatedAt > TWELVE_HOURS_MS;
};

function extractMaxUpdatedAt(data: unknown): number {
  if (!data) return 0;

  const maxValues: number[] = [];
  function traverse(obj: unknown) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(traverse);
    } else {
      const record = obj as Record<string, unknown>;
      const updatedAtValue = record['updatedAt'];
      if (typeof updatedAtValue === 'number') {
        maxValues.push(updatedAtValue);
      }
      Object.values(record).forEach(traverse);
    }
  }
  traverse(data);
  return maxValues.length > 0 ? Math.max(...maxValues) : 0;
}

function getId(item: unknown): string | undefined {
  return item && typeof item === 'object' && 'id' in item ? (item as { id: string }).id : undefined;
}

function mergeWithExistingData<T>(existing: T | undefined, incoming: T, lastUpdatedAt: number): T {
  if (!existing) return incoming;

  if (Array.isArray(existing) && Array.isArray(incoming)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merged = [...existing] as any[];
    for (const item of incoming) {
      const id = getId(item);
      if (!id) continue;
      const idx = merged.findIndex(m => getId(m) === id);
      const itemUpdatedAt = (item as Record<string, unknown>)['updatedAt'];
      if (idx < 0) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        merged.push(item);
      } else if (typeof itemUpdatedAt === 'number' && itemUpdatedAt > lastUpdatedAt) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        merged[idx] = item;
      }
    }
    return merged as unknown as T;
  }

  if (typeof existing === 'object' && typeof incoming === 'object' && existing && incoming) {
    const e = existing as Record<string, unknown>;
    const n = incoming as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(n).map(k => [k, mergeWithExistingData(e[k], n[k], lastUpdatedAt)]),
    ) as T;
  }

  return incoming;
}

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
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseCachedQueryOptions | UseQueryOptions | boolean,
): QueryResult<TReturn> {
  const updatedAtEnabled =
    typeof options === 'object' && options !== null && 'updatedAtEnabled' in options
      ? options.updatedAtEnabled
      : false;

  const zero = useZero();

  // Compute hash using the query's internal fn which returns a QueryImpl with hash()
  const hash = useMemo(() => {
    // @ts-expect-error - accessing internal query structure
    const queryImpl = query.query.fn({ ctx: zero.context, args: query.args });
    // @ts-expect-error - hash() is part of QueryInternals, not public Query interface
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return queryImpl.hash() as string;
  }, [query, zero.context]);

  const cacheEntry = useSelector(queryCacheActor, state => {
    return hash ? state.context.cache.get(hash) : undefined;
  }) as CacheEntry<TReturn> | undefined;

  const hasCachedData = cacheEntry?.data?.[0] !== null && cacheEntry?.data?.[0] !== undefined;
  const lastUpdatedAt = cacheEntry?.lastUpdatedAt;

  // Enable delta query when flag is passed, has cached data, and lastUpdatedAt exists
  const shouldEnableDelta = updatedAtEnabled && !!lastUpdatedAt && hasCachedData;

  const prevFreshDataRef = useRef<unknown>(undefined);
  const initialLoadStartedRef = useRef(false);

  const modifiedQueryRequest = useMemo(() => {
    if (!shouldEnableDelta || !lastUpdatedAt) {
      return query;
    }

    // Add lastUpdatedAt to args - defineQuery will extract it and apply delta filter
    const baseArgs = typeof query.args === 'object' && query.args !== null ? query.args : {};

    return {
      ...query,
      args: Object.assign({}, baseArgs, { lastUpdatedAt }),
    } as unknown;
  }, [query, shouldEnableDelta, lastUpdatedAt]);

  // Initial load when no cached data exists
  useEffect(() => {
    if (updatedAtEnabled && !hasCachedData && !initialLoadStartedRef.current && hash) {
      initialLoadStartedRef.current = true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-floating-promises
      (async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          const result = await (zero as any).run(query, { type: 'complete' });
          const maxUpdatedAt = extractMaxUpdatedAt(result);
          queryCacheActor.send({
            type: 'SET_KEY',
            hash,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
            data: [result, { type: 'complete' }] as any,
            lastUpdatedAt: maxUpdatedAt,
          });
        } catch (error) {
          initialLoadStartedRef.current = false;
          logger.error(Event.ZERO_RUN_ERROR, { error });
        }
      })();
    }
  }, [updatedAtEnabled, hasCachedData, hash, zero, query]);

  const [freshData, freshDetails] = useQuery(modifiedQueryRequest as typeof query, options);

  // Update cache when fresh data arrives
  useEffect(() => {
    if (freshDetails.type === 'complete' && hash && freshData !== prevFreshDataRef.current) {
      prevFreshDataRef.current = freshData;

      if (updatedAtEnabled) {
        const existingData = cacheEntry?.data?.[0];
        const currentLastUpdatedAt = cacheEntry?.lastUpdatedAt ?? 0;
        const newMaxUpdatedAt = extractMaxUpdatedAt(freshData);
        const mergedData = existingData
          ? mergeWithExistingData(existingData, freshData, currentLastUpdatedAt)
          : freshData;

        const effectiveLastUpdatedAt = shouldUpdateLastUpdatedAt(currentLastUpdatedAt)
          ? Math.max(currentLastUpdatedAt, newMaxUpdatedAt)
          : currentLastUpdatedAt;

        queryCacheActor.send({
          type: 'SET_KEY',
          hash,
          data: [mergedData, freshDetails],
          lastUpdatedAt: effectiveLastUpdatedAt,
        });
      } else {
        queryCacheActor.send({
          type: 'SET_KEY',
          hash,
          data: [freshData, freshDetails],
        });
      }
    }
  }, [freshData, freshDetails, hash, cacheEntry]);

  if (updatedAtEnabled && hasCachedData) {
    return cacheEntry.data;
  }

  return cacheEntry?.data ?? [freshData, freshDetails];
}
