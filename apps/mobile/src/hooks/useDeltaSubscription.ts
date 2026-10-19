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
import {
  QueryCacheLogEvent,
  formatUnknownError,
  queryCacheLogError,
} from '../utils/queryCacheLogger';

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

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const shouldUpdateWatermark = (currentWm: number): boolean => {
  return Date.now() - currentWm > TWELVE_HOURS_MS;
};

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

  const hash = useMemo(() => {
    const queryImpl = query.query.fn({ ctx: zero.context, args: query.args });
    // @ts-expect-error hash() on QueryImpl
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return queryImpl.hash() as string;
  }, [query, zero.context]);

  const getEffectiveWatermark = (newWm: number): number => {
    return shouldUpdateWatermark(watermarkRef.current) ? newWm : watermarkRef.current;
  };

  useEffect(() => {
    if (isLoaded) {
      setIsInitialFetchDone(true);
    }
  }, [isLoaded]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (isLoaded) {
      setIsInitialFetchDone(true);
      return;
    }

    if (hash) {
      const cacheEntry = queryCacheActor.getSnapshot().context.cache.get(hash);
      if (cacheEntry) {
        const [cachedItems] = cacheEntry.data as [HumanReadable<TReturn>, unknown];
        const hasData = Array.isArray(cachedItems) ? cachedItems.length > 0 : cachedItems !== null;
        if (hasData) {
          const wm = computeWatermarkRef.current(cachedItems);
          onInitialLoadRef.current(cachedItems, getEffectiveWatermark(wm));
          setIsInitialFetchDone(true);
          return;
        }
      }
    }

    let cancelled = false;

    const fetchAll = async (): Promise<void> => {
      try {
        const items = await zero.run(queryRef.current, { type: 'complete' });
        if (cancelled) {
          return;
        }

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

        setIsInitialFetchDone(true);
      } catch (err) {
        if (cancelled) {
          return;
        }

        queryCacheLogError(QueryCacheLogEvent.APP_REFRESH, {
          trigger: `INITIAL_${queryName.toUpperCase()}_FETCH_FAILED`,
          error: formatUnknownError(err),
          queryName,
          workspaceId: zero.context.workspaceId,
          userId: zero.context.userID,
        });
      }
    };

    void fetchAll();

    return () => {
      cancelled = true;
    };
  }, [zero, isHydrated, isLoaded, hash, queryName]);

  const deltaQueryInput = useMemo(
    () => queryRef.current.query({ updatedAt: watermark } as TInput),
    // queryName + watermark: rebuild when subscription watermark moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
