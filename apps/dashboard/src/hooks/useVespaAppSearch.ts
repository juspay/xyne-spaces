import { useCallback, useEffect, useRef, useState } from 'react';
import { appsService, type AppSearchHit, type AppsView } from '../services/Apps/appsService';

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 50;

interface UseVespaAppSearchResult {
  hits: AppSearchHit[];
  total: number;
  isSearching: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * Debounced app search via Vespa, scoped to the active Apps view, with offset
 * pagination. A new query (or view change) resets to page 0; `loadMore()` appends
 * the next page until all `total` matches are loaded. `reload()` re-fetches page 0
 * (e.g. to refresh install state after installing). Rows render straight from the
 * response.
 */
export function useVespaAppSearch(query: string, view: AppsView): UseVespaAppSearchResult {
  const [hits, setHits] = useState<AppSearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const reqIdRef = useRef(0);
  const nextOffsetRef = useRef(0);

  // Run a page fetch. replace=true resets the list; false appends (load more).
  const run = useCallback(
    (q: string, offset: number, replace: boolean) => {
      setIsSearching(true);
      const reqId = ++reqIdRef.current;
      void (async () => {
        try {
          const { results, total: t } = await appsService.search(q, view, PAGE_SIZE, offset);
          if (reqId !== reqIdRef.current) return;
          setTotal(t);
          setHits(prev => (replace ? results : [...prev, ...results]));
          nextOffsetRef.current = offset + results.length;
        } catch {
          if (reqId === reqIdRef.current && replace) {
            setHits([]);
            setTotal(0);
          }
        } finally {
          if (reqId === reqIdRef.current) setIsSearching(false);
        }
      })();
    },
    [view],
  );

  // New/changed query → debounce, then fetch page 0.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      reqIdRef.current++; // cancel any in-flight
      setHits([]);
      setTotal(0);
      nextOffsetRef.current = 0;
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(() => {
      nextOffsetRef.current = 0;
      run(trimmed, 0, true);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  const hasMore = hits.length < total;

  const loadMore = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed && !isSearching && hits.length < total) {
      run(trimmed, nextOffsetRef.current, false);
    }
  }, [query, isSearching, hits.length, total, run]);

  // Re-fetch page 0 (resets the list) — used to refresh install state after an install.
  const reload = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed) {
      nextOffsetRef.current = 0;
      run(trimmed, 0, true);
    }
  }, [query, run]);

  return { hits, total, isSearching, hasMore, loadMore, reload };
}
