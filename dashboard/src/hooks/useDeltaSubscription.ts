import { useEffect, useRef, useMemo, useState } from 'react';
import type {
  QueryRequest,
  DefaultSchema,
  DefaultContext,
  PullRow,
  ReadonlyJSONValue,
  HumanReadable,
} from '@rocicorp/zero';
import type { UseQueryOptions } from '@rocicorp/zero/react';
import { useZero } from './useZero';
import { useCachedQuery } from './useCachedQuery';
import { queryCacheActor } from '../machines/queryCacheMachine';
import { logger, Event as LoggerEvent } from '../utils/logger';

// Input type for delta queries — must accept an optional updatedAt filter.
type DeltaInput = { updatedAt?: number | undefined } | undefined;

export interface UseDeltaSubscriptionConfig<
  TTable extends keyof DefaultSchema['tables'],
  TInput extends DeltaInput,
  TOutput extends ReadonlyJSONValue | undefined,
  TReturn,
> {
  query: QueryRequest<TTable, TInput, TOutput, DefaultSchema, TReturn, DefaultContext>;
  watermark: number;
  computeWatermark: (items: HumanReadable<TReturn>) => number;
  isLoaded: boolean;
  isHydrated: boolean;
  onInitialLoad: (items: HumanReadable<TReturn>, watermark: number) => void;
  onDeltaMerge: (items: HumanReadable<TReturn>, watermark: number) => void;
  deltaQueryOptions?: UseQueryOptions | boolean;
}

// Only advance the watermark if the current one is older than 12 hours.
// This prevents unnecessary watermark churn on frequent re-renders.
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const shouldUpdateWatermark = (currentWm: number): boolean => {
  return Date.now() - currentWm > TWELVE_HOURS_MS;
};

/**
 * Hook implementing "initial bulk fetch + live delta subscription":
 * Phase 1: Load from IndexedDB cache or full fetch via zero.run()
 * Phase 2: Live delta subscription via useCachedQuery after watermark
 */
export function useDeltaSubscription<
  TTable extends keyof DefaultSchema['tables'],
  TInput extends DeltaInput,
  TOutput extends ReadonlyJSONValue | undefined,
  TReturn = PullRow<TTable, DefaultSchema>,
>(
  config: UseDeltaSubscriptionConfig<TTable, TInput, TOutput, TReturn>,
): { isInitialFetchDone: boolean } {
  const {
    query,
    watermark,
    computeWatermark,
    isLoaded,
    isHydrated,
    onInitialLoad,
    onDeltaMerge,
    deltaQueryOptions,
  } = config;
  const queryName = query.query.queryName;
  const zero = useZero();

  const [isInitialFetchDone, setIsInitialFetchDone] = useState(isLoaded);

  // Stabilise callbacks across renders so effects don't re-fire.
  const queryRef = useRef(query);
  queryRef.current = query;
  const onInitialLoadRef = useRef(onInitialLoad);
  onInitialLoadRef.current = onInitialLoad;
  const onDeltaMergeRef = useRef(onDeltaMerge);
  onDeltaMergeRef.current = onDeltaMerge;
  const computeWatermarkRef = useRef(computeWatermark);
  computeWatermarkRef.current = computeWatermark;
  const watermarkRef = useRef(watermark);
  watermarkRef.current = watermark;

  // Compute hash using the query's internal fn which returns a QueryImpl with hash()
  const hash = useMemo(() => {
    // Call the query's fn directly with context and args
    // This returns a QueryImpl that has the hash() method
    const queryImpl = query.query.fn({ ctx: zero.context, args: query.args });
    // The queryImpl has a hash() method that returns the AST-based hash
    // @ts-expect-error - hash() is part of QueryInternals, not public Query interface
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return queryImpl.hash() as string;
  }, [query, zero.context]);

  // Only advance the watermark if the current one is older than 12 hours.
  const getEffectiveWatermark = (newWm: number): number => {
    return shouldUpdateWatermark(watermarkRef.current) ? newWm : watermarkRef.current;
  };

  useEffect(() => {
    if (!isHydrated) return;
    if (isLoaded) {
      setIsInitialFetchDone(true);
      return;
    }

    // 1. Try warm cache (queryCacheActor, hydrated from IndexedDB).
    if (hash) {
      const cacheEntry = queryCacheActor.getSnapshot().context.cache.get(hash);
      if (cacheEntry) {
        const [cachedItems] = cacheEntry.data as [HumanReadable<TReturn>, unknown];
        const hasData = Array.isArray(cachedItems) ? cachedItems.length > 0 : cachedItems !== null;
        if (hasData) {
          const wm = computeWatermarkRef.current(cachedItems);
          onInitialLoadRef.current(cachedItems, getEffectiveWatermark(wm));
        }
        setIsInitialFetchDone(true);
        return;
      }
    }

    // 2. Cold cache — full fetch via zero.run().
    const fetchAll = async (): Promise<void> => {
      try {
        const items = await zero.run(queryRef.current);
        const hasItems = Array.isArray(items) ? items.length > 0 : items !== null;
        if (hasItems) {
          const wm = computeWatermarkRef.current(items);
          onInitialLoadRef.current(items, getEffectiveWatermark(wm));

          if (hash) {
            queryCacheActor.send({
              type: 'SET_KEY',
              hash,
              data: [items, { type: 'complete' }],
            });
          }
        }
      } catch (err) {
        logger.error(LoggerEvent.APP_REFRESH, {
          trigger: `INITIAL_${queryName.toUpperCase()}_FETCH_FAILED`,
          error: err,
        });
      } finally {
        setIsInitialFetchDone(true);
      }
    };
    void fetchAll();
  }, [zero, isHydrated, isLoaded, hash]);

  const deltaQueryInput = useMemo(
    () => queryRef.current.query({ updatedAt: watermark } as TInput),
    [queryName, watermark],
  );
  const [deltaData, deltaDetails] = useCachedQuery(deltaQueryInput, deltaQueryOptions);

  useEffect(() => {
    if (deltaDetails.type !== 'complete') return;
    const hasDelta = Array.isArray(deltaData) ? deltaData.length > 0 : deltaData !== null;
    if (!hasDelta) return;

    const newWm = computeWatermarkRef.current(deltaData);
    onDeltaMergeRef.current(deltaData, getEffectiveWatermark(newWm));
  }, [deltaData, deltaDetails.type]);

  return { isInitialFetchDone };
}
