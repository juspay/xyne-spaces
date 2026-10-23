import { useEffect, useRef, useState } from 'react';

import { globalSearchService } from '@/src/services/globalSearchService';
import type { DisplaySearchResult } from '@/src/types/search';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_RESULTS_LIMIT = 25;

export type UseDeskTicketSearchReturn = {
  results: DisplaySearchResult[];
  totalCount: number;
  isSearching: boolean;
  errorMessage: string | null;
  hasQuery: boolean;
};

/**
 * Channel-scoped Vespa mail search for the desk tickets overlay.
 * `apps=mail` + `type=emails` + `in=channelId` mirrors dashboard DESK tab.
 */
export function useDeskTicketSearch(
  channelId: string,
  query: string,
  enabled = true,
): UseDeskTicketSearchReturn {
  const normalizedQuery = query.trim();
  const hasQuery = enabled && Boolean(channelId) && normalizedQuery.length > 0;

  const [results, setResults] = useState<DisplaySearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    if (!hasQuery) {
      setResults([]);
      setTotalCount(0);
      setErrorMessage(null);
      setIsSearching(false);
      requestVersionRef.current += 1;
      return;
    }

    setIsSearching(true);
    setErrorMessage(null);

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    const timer = setTimeout(() => {
      void globalSearchService
        .search({
          query: normalizedQuery,
          apps: 'mail',
          type: 'emails',
          in: channelId,
          // Match dashboard DESK tab (`useSearchMetrics` + GlobalCommandMenu in: chip).
          onlyMyChannels: false,
          presentationSummary: 'lean',
          limit: SEARCH_RESULTS_LIMIT,
          offset: 0,
        })
        .then(page => {
          if (requestVersionRef.current !== requestVersion) return;
          // Dashboard DESK tab uses Vespa results as-is (no client subApp filter).
          // Count email/thread rows we show — not Vespa's aggregate totalCount
          // (can reflect grouped hits / coverage, not filtered emails).
          setResults(page.results);
          setTotalCount(page.results.length);
        })
        .catch((error: unknown) => {
          if (requestVersionRef.current !== requestVersion) return;
          const message =
            error instanceof Error ? error.message : 'Failed to search emails right now.';
          setResults([]);
          setTotalCount(0);
          setErrorMessage(message);
        })
        .finally(() => {
          if (requestVersionRef.current === requestVersion) {
            setIsSearching(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [channelId, hasQuery, normalizedQuery]);

  return {
    results,
    totalCount,
    isSearching,
    errorMessage,
    hasQuery,
  };
}
