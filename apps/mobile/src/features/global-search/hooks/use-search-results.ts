import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { DisplaySearchResult } from '@/src/types/search';
import { fetchSearchResults, toSearchError, type SearchError } from '../api';
import { toSearchParams, type SearchRequest } from '../utils/search-request';

export type SearchResults = {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Rows to show. While `loading` these are the previous query's, if it had any. */
  data: readonly DisplaySearchResult[];
  error: SearchError | null;
  retry: () => void;
};

const EMPTY_RESULTS: readonly DisplaySearchResult[] = Object.freeze([]);
const CATEGORY_KEY_INDEX = 1;

/**
 * Remote results for one request; `null` means there is nothing to search for.
 *
 * A changed request aborts the one in flight — the query function reads `signal`, so
 * the abort reaches the native socket — and results are stored per request, so a late
 * response can never be shown for a newer one.
 */
export function useSearchResults(request: SearchRequest | null): SearchResults {
  const category = request?.category;

  const query = useQuery({
    queryKey: ['global-search', category, request ? toSearchParams(request) : null],
    queryFn: ({ signal }) => fetchSearchResults(request as SearchRequest, signal),
    enabled: request !== null,
    // Keeps the list populated while the next query loads, so it is never torn down
    // mid-typing. Same category only, or Tickets would briefly list messages.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[CATEGORY_KEY_INDEX] === category ? previous : undefined,
    // The error state offers a manual retry; silent retries would only delay it.
    retry: false,
  });

  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const { data = EMPTY_RESULTS, error, isError, isPending, isPlaceholderData } = query;
  const isIdle = request === null;

  // One object per change, so the list below is not handed a new status every render.
  return useMemo((): SearchResults => {
    // Placeholder data outlives a disabled query, so a cleared search is cut off here.
    if (isIdle) return { status: 'idle', data: EMPTY_RESULTS, error: null, retry };
    if (isError) return { status: 'error', data, error: toSearchError(error), retry };

    const status = isPending || isPlaceholderData ? 'loading' : 'success';
    return { status, data, error: null, retry };
  }, [data, error, isError, isIdle, isPending, isPlaceholderData, retry]);
}
