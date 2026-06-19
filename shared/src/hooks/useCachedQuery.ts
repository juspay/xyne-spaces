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
import { queryCacheActor, type CacheEntry, loadCacheEntryFromStorage } from '../machines/queryCacheMachine.js';
import { useSelector } from '@xstate/react';
import { useQuery } from './useQuery.js';
import { useZero, useInstrumentation } from './useZero.js';
import { Event } from '../logger/events.js';
import {
  PAGE_BREAK_MARKER,
  getId,
  insertPageWithBreaks,
  computeCachedWindow,
} from '../utils/paginatedCacheUtils.js';

export interface UseCachedQueryOptions {
  ttl?: TTL | undefined;
  enabled?: boolean | undefined;
  updatedAtEnabled?: boolean;
  /** Enable cursor pagination mode. Cursor fields are automatically derived from the query's orderBy. */
  cursorEnabled?: boolean;
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

  // Cursor mode is active when cursorEnabled flag is set.
  const cursorEnabled =
    typeof options === 'object' && options !== null && 'cursorEnabled' in options
      ? !!options.cursorEnabled
      : false;

  // Extract cursor (start), limit, and direction from query args for filtering
  const queryArgs = query.args as Record<string, unknown> | undefined;
  const cursor = queryArgs?.['start'];
  const limit = (queryArgs?.['limit'] as number) || 0;
  const direction = queryArgs?.['direction'] as 'forward' | 'backward' | undefined;

  const zero = useZero();
  const { logger } = useInstrumentation();

  // Compute hash and extract all orderBy fields from query AST
  const { hash, orderBy } = useMemo(() => {
    // Default: hash the full query as-is (no cursor stripping)
    // @ts-expect-error - accessing internal query structure
    const fullQueryImpl = query.query.fn({ ctx: zero.context, args: query.args });
    // Extract orderBy from AST — Zero stores it as [field, direction] tuples.
    // Normalize to { field, direction } objects for downstream utilities.
    // @ts-expect-error - accessing internal query structure
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const ast = fullQueryImpl.ast;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const rawOrderBy = ast?.orderBy as readonly [string, 'asc' | 'desc'][] | undefined;
    const extractedOrderBy = rawOrderBy?.map(([field, direction]) => ({ field, direction }));

    if (cursorEnabled) {
      // For cursor-paginated queries, strip `start` and `direction` from args so that
      // all pages of the same query (both directions) share a single cache bucket.
      const rawArgs = (query.args ?? {}) as Record<string, unknown>;
      const strippedArgs: Record<string, unknown> = { ...rawArgs, start: null };
      delete strippedArgs['direction'];
      try {
        // @ts-expect-error - accessing internal query structure
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const queryImpl = query.query.fn({ ctx: zero.context, args: strippedArgs });
        // @ts-expect-error - accessing internal query structure
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const computedHash = queryImpl.hash() as string;
        return { hash: computedHash, orderBy: extractedOrderBy };
      } catch {
        // Fall through to default hash below
      }
    }
    // @ts-expect-error - accessing internal query structure
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return { hash: fullQueryImpl.hash() as string, orderBy: extractedOrderBy };
  }, [query, zero.context, cursorEnabled]);

  const cacheEntry = useSelector(queryCacheActor, state => {
    return hash ? state.context.cache.get(hash) : undefined;
  }) as CacheEntry<TReturn> | undefined;

  // Lazy-load from IndexedDB on cache miss (entry was evicted or not hydrated)
  const idbLoadAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hash || cacheEntry || idbLoadAttemptedRef.current === hash) return;
    idbLoadAttemptedRef.current = hash;

    void loadCacheEntryFromStorage(hash).then(entry => {
      if (entry?.data) {
        const current = queryCacheActor.getSnapshot().context.cache.get(hash);
        if (current) return;

        queryCacheActor.send({
          type: 'SET_KEY',
          hash,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
          data: entry.data as any,
          lastUpdatedAt: entry.lastUpdatedAt,
        });
      }
    });
  }, [hash, cacheEntry]);

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

  // Strip UseCachedQueryOptions-specific fields before passing to Zero's useQuery.
  // Zero only accepts { enabled?, ttl? }. Passing unknown fields like cursorFields
  // causes Zero to error-state and retry, multiplying subscriptions -> 429.
  const zeroCompatibleOptions = useMemo(() => {
    const enabled =
      typeof options === 'object' && options !== null && 'enabled' in options
        ? (options as { enabled?: boolean }).enabled
        : undefined;
    const ttl =
      typeof options === 'object' && options !== null && 'ttl' in options
        ? (options as { ttl?: TTL }).ttl
        : undefined;
    if (enabled === undefined && ttl === undefined) return undefined;
    return {
      ...(enabled !== undefined && { enabled }),
      ...(ttl !== undefined && { ttl }),
    };
  }, [options]);

  const [freshData, freshDetails] = useQuery(
    modifiedQueryRequest as typeof query,
    zeroCompatibleOptions,
  );

  // Compute cursor pagination window (pure function, no side effects)
  const cursorWindow = useMemo(() => {
    if (!cursorEnabled) {
      return { hasCachedWindow: false, data: null, details: null };
    }
    return computeCachedWindow({
      cacheEntry,
      cursor,
      limit,
      direction,
      ...(orderBy && { orderBy }),
    });
  }, [cursorEnabled, cacheEntry, cursor, limit, direction, orderBy]);

  // Update cache when fresh data arrives
  useEffect(() => {
    if (freshDetails.type === 'complete' && hash && freshData !== prevFreshDataRef.current) {
      prevFreshDataRef.current = freshData;

      if (cursorEnabled) {
        // Cursor pagination: merge with breaks for non-contiguous jumps
        const existingData = cacheEntry?.data?.[0];
        const mergedData =
          existingData && Array.isArray(existingData) && Array.isArray(freshData)
            ? insertPageWithBreaks(
                // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
                existingData as (Record<string, unknown> | typeof PAGE_BREAK_MARKER)[],
                freshData as Record<string, unknown>[],
                cursor,
                limit,
                direction,
                orderBy,
              )
            : freshData;
        queryCacheActor.send({
          type: 'SET_KEY',
          hash,
          data: [mergedData, freshDetails],
        });
      } else if (updatedAtEnabled) {
        // Delta sync: merge by updatedAt
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
        // Default: just cache the fresh data
        queryCacheActor.send({
          type: 'SET_KEY',
          hash,
          data: [freshData, freshDetails],
        });
      }
    }
  }, [
    freshData,
    freshDetails,
    hash,
    cursorEnabled,
    updatedAtEnabled,
    cacheEntry,
    cursor,
    limit,
    direction,
    orderBy,
    shouldEnableDelta,
  ]);

  // Return based on mode
  if (updatedAtEnabled && hasCachedData) {
    return cacheEntry.data;
  }

  if (cursorEnabled && cursorWindow.hasCachedWindow) {
    return [cursorWindow.data, cursorWindow.details] as QueryResult<TReturn>;
  }

  // For cursor-paginated queries, when the cache doesn't have the requested window
  // (cursor not found or cache empty), always return the live Zero query result so
  // the component sees the correct loading->complete lifecycle and fresh page data.
  // Returning cacheEntry.data here would expose the raw accumulated cache array
  // (which may contain PAGE_BREAK_MARKERs) as activitiesPage, breaking accumulation.
  if (cursorEnabled) {
    return [freshData, freshDetails];
  }

  return cacheEntry?.data ?? [freshData, freshDetails];
}
