import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { DisplaySearchResult, VespaSearchResultsPage } from '@/src/types/search';
import { fetchSearchResultsPage, toSearchError, type SearchError } from '../api';
import {
  MAX_BACKEND_OFFSET,
  RESULTS_LIMIT,
  toSearchIdentityParams,
  type SearchRequest,
} from '../utils/search-request';

export type SearchResults = {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Rows to show. While `loading` these are the previous query's, if it had any. */
  data: readonly DisplaySearchResult[];
  error: SearchError | null;
  retry: () => void;
  /** True when another page can be fetched (dashboard infinite-scroll parity). */
  hasMore: boolean;
  /** Fetch the next offset window; no-op while a page is already loading. */
  loadMore: () => void;
  /** True while a load-more page is in flight (first page uses `status === 'loading'`). */
  isFetchingMore: boolean;
};

const EMPTY_RESULTS: readonly DisplaySearchResult[] = Object.freeze([]);
/** Category sits at index 2 — keep in sync with the queryKey below. */
const CATEGORY_KEY_INDEX = 2;

type SearchPage = VespaSearchResultsPage;
type SearchInfiniteData = InfiniteData<SearchPage, number>;

function isSearchInfiniteData(value: unknown): value is SearchInfiniteData {
  if (value == null || typeof value !== 'object') return false;
  const pages = (value as SearchInfiniteData).pages;
  const pageParams = (value as SearchInfiniteData).pageParams;
  return Array.isArray(pages) && Array.isArray(pageParams);
}

function nextOffset(page: SearchPage | undefined): number | undefined {
  if (!page) return undefined;
  const results = page.results ?? [];
  const offset = page.offset ?? 0;
  const totalCount = page.totalCount ?? 0;
  const following = offset + results.length;
  const hasMore =
    results.length >= RESULTS_LIMIT &&
    following < totalCount &&
    following + RESULTS_LIMIT <= MAX_BACKEND_OFFSET;
  return hasMore ? following : undefined;
}

/**
 * Remote results for one request; `null` means there is nothing to search for.
 *
 * A changed request aborts the one in flight — the query function reads `signal`, so
 * the abort reaches the native socket — and results are stored per request, so a late
 * response can never be shown for a newer one.
 *
 * Pages advance with a fixed `limit` and increasing `offset`, matching dashboard
 * `useSearchMetrics` load-more.
 */
export function useSearchResults(request: SearchRequest | null): SearchResults {
  const category = request?.category;
  const identity = request ? toSearchIdentityParams(request) : null;

  const query = useInfiniteQuery({
    // `infinite` keeps this cache out of the old flat `useQuery` shape under
    // `['global-search', category, …]`, which crashed on `.pages.length`.
    queryKey: ['global-search', 'infinite', category, identity],
    queryFn: ({ pageParam, signal }) =>
      fetchSearchResultsPage(request as SearchRequest, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: lastPage => nextOffset(lastPage),
    enabled: request !== null,
    // Keeps the list populated while the next query loads, so it is never torn down
    // mid-typing. Same category only, or Tickets would briefly list messages.
    placeholderData: (previous, previousQuery): SearchInfiniteData | undefined => {
      if (previousQuery?.queryKey[CATEGORY_KEY_INDEX] !== category) return undefined;
      return isSearchInfiniteData(previous) ? previous : undefined;
    },
    // The error state offers a manual retry; silent retries would only delay it.
    retry: false,
  });

  const { refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const data = useMemo((): readonly DisplaySearchResult[] => {
    const pages = query.data?.pages;
    if (!Array.isArray(pages) || pages.length === 0) return EMPTY_RESULTS;
    if (pages.length === 1) return pages[0]?.results ?? EMPTY_RESULTS;
    const merged: DisplaySearchResult[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      for (const hit of page?.results ?? []) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        merged.push(hit);
      }
    }
    return merged;
  }, [query.data?.pages]);

  const { error, isError, isPending, isPlaceholderData } = query;
  const isIdle = request === null;

  // One object per change, so the list below is not handed a new status every render.
  return useMemo((): SearchResults => {
    // Placeholder data outlives a disabled query, so a cleared search is cut off here.
    if (isIdle) {
      return {
        status: 'idle',
        data: EMPTY_RESULTS,
        error: null,
        retry,
        hasMore: false,
        loadMore,
        isFetchingMore: false,
      };
    }
    if (isError) {
      return {
        status: 'error',
        data,
        error: toSearchError(error),
        retry,
        hasMore: false,
        loadMore,
        isFetchingMore: false,
      };
    }

    const status = isPending || isPlaceholderData ? 'loading' : 'success';
    return {
      status,
      data,
      error: null,
      retry,
      hasMore: Boolean(hasNextPage),
      loadMore,
      isFetchingMore: isFetchingNextPage,
    };
  }, [
    data,
    error,
    hasNextPage,
    isError,
    isFetchingNextPage,
    isIdle,
    isPending,
    isPlaceholderData,
    loadMore,
    retry,
  ]);
}
