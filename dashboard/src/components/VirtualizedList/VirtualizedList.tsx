import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { Components, VirtuosoHandle } from 'react-virtuoso';
import { Virtuoso } from 'react-virtuoso';
import type {
  DefaultContext,
  DefaultSchema,
  QueryRequest,
  ReadonlyJSONValue,
} from '@rocicorp/zero';
import { useCachedQuery, type UseCachedQueryOptions } from '../../hooks/useCachedQuery';

export type PaginationDirection = 'forward' | 'backward';

export interface PaginationQueryParams<TCursor> {
  cursor: TCursor | null;
  direction: PaginationDirection;
  limit: number;
}

export interface PaginationConfig<TItem, TCursor> {
  createQuery: (params: PaginationQueryParams<TCursor>) => unknown;
  getCursor: (item: TItem) => TCursor;
  getKey: (item: TItem, index: number) => string | number;
  mergePages?: (prev: TItem[], next: TItem[], direction: PaginationDirection) => TItem[];
  windowSize: number;
  threshold?: number;
  resetKey: string | number | Array<string | number>;
  isEnabled?: boolean;
  /** Enable cursor pagination mode. Cursor fields are automatically derived from the query's orderBy. */
  cursorEnabled?: boolean;
}

export interface VirtualizedListProps<TItem, TCursor> {
  pagination: PaginationConfig<TItem, TCursor>;
  renderItem: (item: TItem, index: number) => ReactNode;
  transformItems?: (items: TItem[]) => TItem[];
  onItemsChange?: (items: TItem[]) => void;
  emptyState?: ReactNode;
  loadingState?: ReactNode;
  error?: Error | null;
  errorState?: (error: Error) => ReactNode;
  className?: string;
  style?: CSSProperties;
  virtuosoRef?: React.Ref<VirtuosoHandle>;
  virtuoso?: {
    fixedItemHeight?: number;
    overscan?: number | { main: number; reverse: number };
    increaseViewportBy?: number | { top: number; bottom: number };
    components?: Components<TItem>;
    customScrollParent?: HTMLElement | null;
    initialItemCount?: number;
  };
}

export const VirtualizedList = <TItem, TCursor>({
  pagination,
  renderItem,
  transformItems,
  onItemsChange,
  emptyState,
  loadingState,
  error,
  errorState,
  className,
  style,
  virtuosoRef,
  virtuoso,
}: VirtualizedListProps<TItem, TCursor>): ReactElement => {
  const {
    createQuery,
    getCursor,
    getKey,
    mergePages,
    windowSize,
    threshold: rawThreshold = 10,
    resetKey,
    isEnabled = true,
    cursorEnabled,
  } = pagination;

  const threshold = Math.min(rawThreshold, Math.max(0, windowSize - 1));

  const [items, setItems] = useState<TItem[]>([]);
  const [cursor, setCursor] = useState<TCursor | null>(null);
  const [direction, setDirection] = useState<PaginationDirection>('forward');
  const [isLoading, setIsLoading] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);

  const itemsRef = useRef<TItem[]>([]);
  const cursorIndexRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestRef = useRef<{ direction: PaginationDirection; cursorKey: string } | null>(null);

  const resetKeyValue = useMemo(() => JSON.stringify(resetKey), [resetKey]);

  useEffect(() => {
    itemsRef.current = [];
    setItems([]);
    setCursor(null);
    setDirection('forward');
    setIsLoading(false);
    cursorIndexRef.current = 0;
    lastRequestRef.current = null;
    setResetVersion(prev => prev + 1);
  }, [resetKeyValue]);

  const query = useMemo(
    () => createQuery({ cursor, direction, limit: windowSize }),
    [createQuery, cursor, direction, windowSize],
  );

  // Build useCachedQuery options.
  const queryOptions = useMemo<UseCachedQueryOptions | boolean>(() => {
    if (cursorEnabled) {
      const opts: UseCachedQueryOptions = { cursorEnabled: true };
      if (!isEnabled) opts.enabled = false;
      return opts;
    }
    return isEnabled;
  }, [isEnabled, cursorEnabled]);

  const [page, queryDetails] = useCachedQuery(
    query as QueryRequest<
      keyof DefaultSchema['tables'],
      ReadonlyJSONValue | undefined,
      ReadonlyJSONValue | undefined,
      DefaultSchema,
      ReadonlyArray<TItem>,
      DefaultContext
    >,
    queryOptions,
  );

  useEffect(() => {
    if (!isEnabled) return;

    if (queryDetails.type === 'error') {
      setIsLoading(false);
      return;
    }

    if (queryDetails.type !== 'complete') {
      setIsLoading(true);
      return;
    }

    setIsLoading(false);

    const typedPage = page as unknown as ReadonlyArray<TItem> | undefined;
    const nextPage = Array.from(typedPage ?? []);

    if (nextPage.length === 0) {
      return;
    }

    const merged =
      cursor === null
        ? nextPage
        : mergePages
          ? mergePages(itemsRef.current, nextPage, direction)
          : mergeByKey(itemsRef.current, nextPage, getKey);

    if (!areItemsEqual(itemsRef.current, merged, getKey)) {
      itemsRef.current = merged;
      setItems(merged);
      onItemsChange?.(merged);
    }
  }, [
    queryDetails.type,
    page,
    cursor,
    direction,
    windowSize,
    mergePages,
    getKey,
    onItemsChange,
    isEnabled,
    resetVersion,
  ]);

  const loadMoreNext = useCallback(() => {
    if (isLoading || itemsRef.current.length === 0) return;
    if (cursor === null && itemsRef.current.length < windowSize) return;
    const lastItem = itemsRef.current[itemsRef.current.length - 1];
    if (!lastItem) return;

    cursorIndexRef.current = itemsRef.current.length;
    const nextCursor = getCursor(lastItem);
    const cursorKey = nextCursor === null ? 'null' : JSON.stringify(nextCursor);
    const lastRequest = lastRequestRef.current;
    if (lastRequest && lastRequest.direction === 'forward' && lastRequest.cursorKey === cursorKey) {
      return;
    }
    lastRequestRef.current = { direction: 'forward', cursorKey };
    setDirection('forward');
    setCursor(nextCursor);
  }, [isLoading, getCursor, cursor, windowSize]);

  const onVisibleRangeChanged = useCallback(
    (startIndex: number) => {
      if (isLoading) return;
      const currentItems = itemsRef.current;
      if (currentItems.length === 0) return;

      const windowStart = cursorIndexRef.current;
      const windowEnd = windowStart + windowSize;
      let nextIdx: number | undefined;
      let nextCursor: TCursor | null | undefined;
      let nextDirection: PaginationDirection | undefined;

      if (startIndex + threshold >= windowEnd) {
        nextIdx = Math.min(windowStart + threshold, currentItems.length - 1);
        const nextItem = currentItems[nextIdx];
        if (nextItem) nextCursor = getCursor(nextItem);
        nextDirection = 'forward';
      } else if (startIndex < windowStart + threshold && windowStart > 0) {
        nextIdx = Math.max(windowStart - threshold, 0);
        if (nextIdx === 0) {
          nextCursor = null;
        } else {
          const nextItem = currentItems[nextIdx];
          if (nextItem) nextCursor = getCursor(nextItem);
        }
        nextDirection = 'backward';
      }

      if (nextCursor === undefined || nextIdx === undefined || !nextDirection) return;

      const cursorKey = nextCursor === null ? 'null' : JSON.stringify(nextCursor);
      const lastRequest = lastRequestRef.current;
      if (
        lastRequest &&
        lastRequest.direction === nextDirection &&
        lastRequest.cursorKey === cursorKey
      ) {
        return;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        cursorIndexRef.current = nextIdx;
        lastRequestRef.current = { direction: nextDirection, cursorKey };
        setDirection(nextDirection);
        setCursor(nextCursor);
      }, 150);
    },
    [getCursor, windowSize, threshold, isLoading],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const transformedItems = transformItems ? transformItems(items) : items;
  const derivedError =
    error ?? (queryDetails.type === 'error' ? new Error(queryDetails.error.message) : null);

  if (derivedError && errorState) {
    return <>{errorState(derivedError)}</>;
  }

  if (isLoading && transformedItems.length === 0) {
    return <>{loadingState ?? null}</>;
  }

  if (!isLoading && transformedItems.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <Virtuoso<TItem>
      data={transformedItems}
      className={className}
      style={style}
      itemContent={(index, item) => renderItem(item, index)}
      computeItemKey={(index, item) => getKey(item, index)}
      endReached={loadMoreNext}
      rangeChanged={range => onVisibleRangeChanged(range.startIndex)}
      {...(virtuosoRef ? { ref: virtuosoRef } : {})}
      {...(virtuoso?.fixedItemHeight !== undefined && {
        defaultItemHeight: virtuoso.fixedItemHeight,
      })}
      {...(virtuoso?.overscan !== undefined && { overscan: virtuoso.overscan })}
      {...(virtuoso?.increaseViewportBy !== undefined && {
        increaseViewportBy: virtuoso.increaseViewportBy,
      })}
      {...(virtuoso?.components && { components: virtuoso.components })}
      {...(virtuoso?.customScrollParent ? { customScrollParent: virtuoso.customScrollParent } : {})}
      {...(virtuoso?.initialItemCount !== undefined
        ? { initialItemCount: virtuoso.initialItemCount }
        : {})}
    />
  );
};

const mergeByKey = <TItem,>(
  prev: TItem[],
  next: TItem[],
  getKey: (item: TItem, index: number) => string | number,
): TItem[] => {
  const order: Array<string | number> = [];
  const map = new Map<string | number, TItem>();

  prev.forEach((item, index) => {
    const key = getKey(item, index);
    if (!map.has(key)) order.push(key);
    map.set(key, item);
  });

  next.forEach((item, index) => {
    const key = getKey(item, index);
    if (!map.has(key)) order.push(key);
    map.set(key, item);
  });

  return order.map(key => map.get(key)!).filter(Boolean);
};

const areItemsEqual = <TItem,>(
  prev: TItem[],
  next: TItem[],
  getKey: (item: TItem, index: number) => string | number,
): boolean => {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const prevItem = prev[i];
    const nextItem = next[i];
    if (!prevItem || !nextItem) return false;
    if (getKey(prevItem, i) !== getKey(nextItem, i)) return false;
    if (prevItem !== nextItem) return false;
  }
  return true;
};
