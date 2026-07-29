import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import type {
  BaseDefaultSchema,
  DefaultSchema,
  BaseDefaultContext,
  DefaultContext,
  PullRow,
  ReadonlyJSONValue,
} from '@rocicorp/zero';
import type { QueryResult, UseQueryOptions } from '@rocicorp/zero/react';
import type { QueryRequest } from '@rocicorp/zero';
import {
  queryCacheActor,
  loadCacheEntryFromStorage,
  type CacheEntry,
} from '../machines/queryCacheMachine.js';
import { consumeShadow } from '../utils/warmShadow.js';
import { useQuery } from './useQuery.js';
import { useZero } from './useZero.js';
import { useFallbackExecutor } from './useFallbackQuery.js';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function extractMaxUpdatedAt(data: unknown): number {
  if (!Array.isArray(data)) return 0;
  let max = 0;
  for (const row of data) {
    const val = (row as Record<string, unknown>)?.['updatedAt'];
    if (typeof val === 'number' && val > max) max = val;
  }
  return max;
}

function mergeById<T>(existing: T[], incoming: T[]): T[] {
  const map = new Map<unknown, T>();
  for (const item of existing) map.set((item as Record<string, unknown>)['id'], item);
  for (const item of incoming) map.set((item as Record<string, unknown>)['id'], item);
  return Array.from(map.values());
}

/**
 * useFallbackHydratedQuery
 *
 * Same return signature as useQuery: [data, details].
 *
 * Phase 1 (runs once after queryCacheActor is hydrated from IDB):
 *   - If cache already has data with a watermark → use it, skip fetch.
 *   - Otherwise → call the fallback REST endpoint, seed the cache.
 *
 * Phase 2 (runs after Phase 1 sets a watermark):
 *   - Subscribe to a Zero useQuery with lastUpdatedAt = watermark.
 *   - Merge deltas into cache by id.
 */
export function useFallbackHydratedQuery<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: { enabled?: boolean },
): QueryResult<TReturn> {
  const enabled = options?.enabled ?? true;
  const zero = useZero();
  const executeFallback = useFallbackExecutor();

  // Compute query hash from AST (same pattern as useCachedQuery)
  const hash = useMemo(() => {
    // @ts-expect-error - accessing internal query structure
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const queryImpl = query.query.fn({ ctx: zero.context, args: query.args });
    // @ts-expect-error - accessing internal query structure
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return queryImpl.hash() as string;
  }, [query, zero.context]);

  const isHydrated = useSelector(queryCacheActor, (s) => s.context.isHydrated);

  const cacheEntry = useSelector(queryCacheActor, (s) =>
    hash ? s.context.cache.get(hash) : undefined,
  ) as CacheEntry<TReturn> | undefined;

  // Lazy-load the entry from persistent storage into LOCAL state (not the
  // actor) so we can use it for the freshness decision + as immediate return
  // value on cold boot when the actor cache is empty. We don't `SET_KEY` from
  // IDB — that would trigger the persistence subscriber to re-write the same
  // bytes back to storage. The actor stays as the "live writes" cache; the
  // delta merge below writes the merged view to it, which is what gets
  // persisted onward.
  const [idbEntry, setIdbEntry] = useState<CacheEntry<TReturn> | null>(null);
  const [idbLoaded, setIdbLoaded] = useState(false);
  const idbLoadHashRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hash || idbLoadHashRef.current === hash) return;
    idbLoadHashRef.current = hash;
    void (async (): Promise<void> => {
      // Try shadow first, then IDB. Shadow is a one-shot seed dropped by
      // a native writer (iOS NSE / Android FCM) when a notification just
      // delivered fresh data; consumed on read (deleted from MMKV). Falls
      // back to IDB when no shadow is present.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const userID = (zero.context as { userID?: string })?.userID;
      if (userID) {
        const shadow = await consumeShadow<TReturn>(userID, query.query.queryName, query.args);
        if (shadow?.data) {
          setIdbEntry({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: shadow.data as any,
            lastUpdatedAt: shadow.lastUpdatedAt ?? 0,
          } as CacheEntry<TReturn>);
          setIdbLoaded(true);
          return;
        }
      }
      const entry = await loadCacheEntryFromStorage(hash);
      setIdbEntry((entry as CacheEntry<TReturn> | null) ?? null);
      setIdbLoaded(true);
    })();
  }, [hash, query, zero.context]);

  // Prefer the actor's live entry (freshest — updated by delta merges this
  // session) and fall back to the IDB entry we just loaded.
  const effectiveEntry = cacheEntry ?? idbEntry ?? undefined;
  const cachedData = effectiveEntry?.data?.[0] ?? null;
  const cachedLastUpdatedAt = effectiveEntry?.lastUpdatedAt ?? 0;
  const hasCachedData = cachedData !== null && cachedData !== undefined;

  // Watermark is set once: either from cache or from fallback fetch result.
  const [watermark, setWatermark] = useState(0);
  const fetchStartedRef = useRef(false);

  // Determine once after hydration whether cache is fresh enough to use.
  // Also wait for the IDB lookup to finish — otherwise we'd decide 'stale'
  // before the persisted entry has had a chance to load, and the REST
  // fallback would fire even when a fresh entry sits in storage.
  const cacheDecisionRef = useRef<'pending' | 'fresh' | 'stale'>('pending');
  if (cacheDecisionRef.current === 'pending' && isHydrated && idbLoaded) {
    cacheDecisionRef.current =
      hasCachedData && cachedLastUpdatedAt > 0 && (Date.now() - cachedLastUpdatedAt) < TWELVE_HOURS_MS
        ? 'fresh'
        : 'stale';
  }

  // Sync watermark from cache — only if fresh
  useEffect(() => {
    if (!isHydrated || watermark > 0) return;
    if (cacheDecisionRef.current === 'fresh') {
      setWatermark(cachedLastUpdatedAt);
    }
  }, [isHydrated, cachedLastUpdatedAt, watermark]);

  // Phase 1: Fetch from fallback REST if cache is stale or empty
  useEffect(() => {
    if (!enabled || !isHydrated || watermark > 0 || fetchStartedRef.current) return;
    if (cacheDecisionRef.current === 'fresh') return;
    if (!executeFallback) return;

    fetchStartedRef.current = true;
    const queryName = query.query.queryName;

    executeFallback(queryName, query.args)
      .then((result) => {
        const wm = extractMaxUpdatedAt(result);
        if (hash) {
          queryCacheActor.send({
            type: 'SET_KEY',
            hash,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: [result as any, { type: 'complete' as const }],
            lastUpdatedAt: wm,
          });
        }
        setWatermark(wm || 1); // use 1 as minimum so delta query enables
      })
      .catch(() => {
        // Let delta query run without watermark filter as fallback
        setWatermark(1);
      });
  }, [enabled, isHydrated, watermark, hasCachedData, cachedLastUpdatedAt, hash, query, executeFallback]);

  // Phase 2: Delta subscription — only after watermark is set
  const deltaEnabled = enabled && watermark > 0;

  const deltaQuery = useMemo(() => {
    if (!deltaEnabled || watermark <= 1) return query;
    const baseArgs = (typeof query.args === 'object' && query.args !== null
      ? query.args
      : {}) as Record<string, unknown>;
    return {
      ...query,
      args: { ...baseArgs, lastUpdatedAt: watermark },
    } as unknown as typeof query;
  }, [query, deltaEnabled, watermark]);

  const [deltaData, deltaDetails] = useQuery(deltaQuery, {
    enabled: deltaEnabled,
  } as UseQueryOptions);

  // Merge deltas into cache
  const prevDeltaRef = useRef<unknown>(null);
  useEffect(() => {
    if (!deltaEnabled || deltaDetails.type !== 'complete') return;
    if (deltaData === prevDeltaRef.current) return;
    prevDeltaRef.current = deltaData;
    if (!hash) return;

    const hasNewData = Array.isArray(deltaData) ? deltaData.length > 0 : deltaData != null;
    if (!hasNewData) return;

    const existing = cachedData;
    const merged =
      Array.isArray(existing) && Array.isArray(deltaData)
        ? mergeById(existing, deltaData)
        : deltaData;

    // Advance the persisted watermark to max(existing, deltaMax) so the next
    // mount's delta query starts from the newest row we've seen. Without this
    // the watermark stays pinned at the initial fetch's value and every
    // subsequent delta re-scans the same range.
    const deltaMax = extractMaxUpdatedAt(deltaData);
    const nextLastUpdatedAt = Math.max(effectiveEntry?.lastUpdatedAt ?? 0, deltaMax);

    queryCacheActor.send({
      type: 'SET_KEY',
      hash,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [merged as any, { type: 'complete' as const }],
      lastUpdatedAt: nextLastUpdatedAt,
    });
  }, [deltaData, deltaDetails.type, deltaEnabled, hash, cachedData, effectiveEntry?.lastUpdatedAt]);

  // Return cached data if available (from actor or lazy-loaded IDB entry),
  // otherwise fall through to the live delta query result.
  if (hasCachedData && effectiveEntry) {
    return effectiveEntry.data as QueryResult<TReturn>;
  }
  return [deltaData, deltaDetails] as unknown as QueryResult<TReturn>;
}
