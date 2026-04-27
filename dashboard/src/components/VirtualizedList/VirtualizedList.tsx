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
import { useCachedQuery } from '../../hooks/useCachedQuery';

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
  } = pagination;

  const threshold = Math.min(rawThreshold, Math.max(0, windowSize - 1));

  const [items, setItems] = useState<TItem[]>([]);
  const [cursor, setCursor] = useState<TCursor | null>(null);
  const [direction, setDirection] = useState<PaginationDirection>('forward');
  const [isLoading, setIsLoading] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);

  const itemsRef = useRef<TItem[]>([]);
  const cursorIndexRef = useRef(0);
  const lastVisibleStartIndexRef = useRef(0);
  const allowEndReachedRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestRef = useRef<{ direction: PaginationDirection; cursorKey: string } | null>(null);
  const createQueryRef = useRef(createQuery);
  createQueryRef.current = createQuery;
  const mergePageRef = useRef(mergePages);
  mergePageRef.current = mergePages;
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;
  const onItemsChangeRef = useRef(onItemsChange);
  onItemsChangeRef.current = onItemsChange;
  const lastPageRef = useRef<unknown>(undefined);
  const lastQueryRef = useRef<{ signature: string; pageKeys: Array<string | number> } | null>(null);

  const resetKeyValue = useMemo(() => JSON.stringify(resetKey), [resetKey]);

  useEffect(() => {
    lastPageRef.current = undefined;
    lastQueryRef.current = null;
    itemsRef.current = [];
    setItems([]);
    setCursor(null);
    setDirection('forward');
    setIsLoading(false);
    cursorIndexRef.current = 0;
    lastVisibleStartIndexRef.current = 0;
    allowEndReachedRef.current = true;
    lastRequestRef.current = null;
    setResetVersion(prev => prev + 1);
  }, [resetKeyValue]);

  const query = useMemo(
    () => createQueryRef.current({ cursor, direction, limit: windowSize }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cursor, direction, windowSize, resetVersion],
  );

  const [page, queryDetails] = useCachedQuery(
    query as QueryRequest<
      keyof DefaultSchema['tables'],
      ReadonlyJSONValue | undefined,
      ReadonlyJSONValue | undefined,
      DefaultSchema,
      ReadonlyArray<TItem>,
      DefaultContext
    >,
    isEnabled,
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
    const querySignature = `${direction}:${getCursorKey(cursor)}`;
    const nextPageKeys = nextPage.map((item, index) => getKeyRef.current(item, index));
    const lastQuery = lastQueryRef.current;
    const shouldReplaceCurrentPage =
      lastQuery?.signature === querySignature &&
      !areKeyArraysEqual(lastQuery.pageKeys, nextPageKeys);

    lastQueryRef.current = { signature: querySignature, pageKeys: nextPageKeys };

    if (nextPage.length === 0) {
      lastPageRef.current = page;
      if (cursor === null && itemsRef.current.length > 0) {
        itemsRef.current = [];
        setItems([]);
        onItemsChangeRef.current?.([]);
      }
      return;
    }

    const itemsBeforeMerge =
      shouldReplaceCurrentPage && lastQuery
        ? removeItemsByKeys(itemsRef.current, lastQuery.pageKeys, getKeyRef.current)
        : itemsRef.current;

    const merged =
      cursor === null
        ? nextPage
        : mergePageRef.current
          ? mergePageRef.current(itemsBeforeMerge, nextPage, direction)
          : mergeByKey(itemsBeforeMerge, nextPage, getKeyRef.current);

    const hasPageChanged = lastPageRef.current !== page;
    lastPageRef.current = page;

    const hasChanges =
      hasPageChanged || haveItemsChanged(itemsRef.current, merged, getKeyRef.current);

    if (hasChanges) {
      itemsRef.current = merged;
      setItems(merged);
      onItemsChangeRef.current?.(merged);
    }
  }, [queryDetails.type, page, cursor, direction, windowSize, isEnabled, resetVersion]);

  const loadMoreNext = useCallback(() => {
    if (isLoading || itemsRef.current.length === 0) return;
    if (cursor === null && itemsRef.current.length < windowSize) return;
    if (!allowEndReachedRef.current) return;
    const lastItem = itemsRef.current[itemsRef.current.length - 1];
    if (!lastItem) return;

    cursorIndexRef.current = itemsRef.current.length;
    const nextCursor = getCursor(lastItem);
    const cursorKey = getCursorKey(nextCursor);
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

      const previousStartIndex = lastVisibleStartIndexRef.current;
      if (startIndex > previousStartIndex) {
        allowEndReachedRef.current = true;
      } else if (startIndex < previousStartIndex) {
        allowEndReachedRef.current = false;
      }
      lastVisibleStartIndexRef.current = startIndex;

      const windowStart = cursorIndexRef.current;
      const windowEnd = windowStart + windowSize;
      let nextIdx: number | undefined;
      let nextCursor: TCursor | null | undefined;
      let nextDirection: PaginationDirection | undefined;

      if (startIndex === 0 && windowStart > 0 && startIndex < previousStartIndex) {
        nextIdx = 0;
        nextCursor = null;
        nextDirection = 'forward';
      } else if (startIndex + threshold >= windowEnd) {
        nextIdx = Math.min(windowStart + threshold, currentItems.length - 1);
        const nextItem = currentItems[nextIdx];
        if (nextItem) nextCursor = getCursor(nextItem);
        nextDirection = 'forward';
      } else if (startIndex < windowStart + threshold && windowStart > 0) {
        nextIdx = Math.max(windowStart - threshold, 0);
        if (nextIdx === 0) {
          nextCursor = null;
          nextDirection = 'forward';
        } else {
          const nextItem = currentItems[nextIdx];
          if (nextItem) nextCursor = getCursor(nextItem);
          nextDirection = 'backward';
        }
      }

      if (nextCursor === undefined || nextIdx === undefined || !nextDirection) return;

      const cursorKey = getCursorKey(nextCursor);
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
        if (nextCursor === null) {
          allowEndReachedRef.current = false;
        }
        lastRequestRef.current = { direction: nextDirection, cursorKey };
        setDirection(nextDirection);
        setCursor(nextCursor);
      }, 150);
    },
    [getCursor, windowSize, threshold, isLoading],
  );

  useEffect(
    (): (() => void) => () => {
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

const removeItemsByKeys = <TItem,>(
  items: TItem[],
  keysToRemove: Array<string | number>,
  getKey: (item: TItem, index: number) => string | number,
): TItem[] => {
  if (keysToRemove.length === 0) return items;

  const keySet = new Set(keysToRemove);
  return items.filter((item, index) => !keySet.has(getKey(item, index)));
};

const haveItemsChanged = <TItem,>(
  prev: TItem[],
  next: TItem[],
  getKey: (item: TItem, index: number) => string | number,
): boolean => {
  if (prev.length !== next.length) return true;

  for (let i = 0; i < prev.length; i += 1) {
    const prevItem = prev[i];
    const nextItem = next[i];

    if (!prevItem || !nextItem) return true;
    if (getKey(prevItem, i) !== getKey(nextItem, i)) return true;
    if (prevItem !== nextItem) return true;
  }

  return false;
};

const getCursorKey = <TCursor,>(cursor: TCursor | null): string =>
  cursor === null ? 'null' : JSON.stringify(cursor);

const areKeyArraysEqual = (prev: Array<string | number>, next: Array<string | number>): boolean => {
  if (prev.length !== next.length) return false;

  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] !== next[i]) return false;
  }

  return true;
};
