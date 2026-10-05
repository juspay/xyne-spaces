import { useCallback, useEffect, useRef, useState } from 'react';
import { searchService } from '../services/searchService';

const DEFAULT_LIMIT = 100;

interface UseVespaTagSearchParams {
  /**
   * Projects whose tag catalogs to search. Plural because "My tickets" and custom
   * views span several projects at once; the backend ORs them.
   */
  projectIds?: string[] | undefined;
  searchQuery?: string | undefined;
  enabled?: boolean | undefined;
  limit?: number | undefined;
}

interface UseVespaTagSearchResult {
  tags: string[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: Error | null;
  refetch: () => void;
}

/**
 * Search a project's tag catalog via Vespa, one page at a time.
 *
 * Note: the caller should debounce searchQuery — this hook fetches immediately.
 *
 * Paging model: a query change resets to page 0 and REPLACES the list; loadMore()
 * appends the next page. Both go through the same fetch, distinguished by the
 * `append` flag, so there is one code path and one abort controller.
 */
export const useVespaTagSearch = ({
  projectIds,
  searchQuery = '',
  enabled = true,
  limit = DEFAULT_LIMIT,
}: UseVespaTagSearchParams): UseVespaTagSearchResult => {
  const [tags, setTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // How many hits have been REQUESTED so far (pages * limit), which is what the
  // next offset must be. Deliberately not tags.length: the backend dedupes tag
  // names within a page, so the list is usually shorter than what was fetched, and
  // offsetting by it would re-request rows already seen and stall on duplicates.
  const fetchedCountRef = useRef(0);
  // Guards loadMore against the in-flight page: without it, a fast scroll fires
  // several loadMore() calls that all read the same offset and append the same page.
  const isFetchingRef = useRef(false);
  // Names already shown, so a page that yields nothing NEW can be detected.
  const seenNamesRef = useRef<Set<string>>(new Set());
  // Bounds the auto-advance below so a long run of all-duplicate pages cannot
  // spin indefinitely; the user's next scroll resumes from wherever it stopped.
  const MAX_AUTO_ADVANCE = 5;

  const projectIdsKey = (projectIds ?? []).join(',');

  // Self-reference so the auto-advance above can re-enter without making fetchTags
  // depend on itself.
  const fetchTagsRef = useRef<
    ((q: string, append: boolean, autoAdvance: number) => Promise<void>) | null
  >(null);

  const fetchTags = useCallback(
    async (query: string, append: boolean, autoAdvance = 0) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const offset = append ? fetchedCountRef.current : 0;
      isFetchingRef.current = true;
      if (append) setIsLoadingMore(true);
      else setIsLoading(true);

      try {
        const result = await searchService.searchTags(
          {
            projectIds: projectIdsKey ? projectIdsKey.split(',') : undefined,
            query: query || undefined,
            limit,
            offset,
          },
          abortController.signal,
        );

        if (!abortController.signal.aborted) {
          fetchedCountRef.current = offset + limit;
          setHasMore(result.hasMore);

          // Dedupe across pages, not just within one: the same tag NAME can live in
          // several projects, so a later page can repeat a name already shown.
          if (!append) seenNamesRef.current = new Set();
          // new Set() first: dedupes WITHIN the page as well as across pages. The
          // backend already dedupes per page, but relying on that would make this
          // list corrupt the moment that changed.
          const freshNames = Array.from(new Set(result.tags)).filter(
            t => !seenNamesRef.current.has(t),
          );
          freshNames.forEach(t => seenNamesRef.current.add(t));

          setTags(prev => (append ? [...prev, ...freshNames] : result.tags));
          setError(null);

          // A page can be full of documents yet contribute zero NEW names (the same
          // name in several projects). The list then does not grow, the scroll
          // container does not get taller, no further scroll event fires — and
          // paging stalls at the bottom with hasMore still true. Pull the next page
          // ourselves instead of waiting for a scroll that cannot happen.
          if (
            append &&
            freshNames.length === 0 &&
            result.hasMore &&
            autoAdvance < MAX_AUTO_ADVANCE
          ) {
            isFetchingRef.current = false;
            void fetchTagsRef.current?.(query, true, autoAdvance + 1);
            return;
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          setError(err instanceof Error ? err : new Error('Failed to fetch tags'));
          setHasMore(false);
          // Keep what is already on screen when a LATER page fails; only a failed
          // first page clears the list.
          if (!append) setTags([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
        isFetchingRef.current = false;
      }
    },
    [projectIdsKey, limit],
  );

  fetchTagsRef.current = fetchTags;

  const loadMore = useCallback(() => {
    if (!enabled || !hasMore || isFetchingRef.current) return;
    void fetchTags(searchQuery, true);
  }, [enabled, hasMore, searchQuery, fetchTags]);

  const refetch = useCallback(() => {
    if (!enabled) return;
    fetchedCountRef.current = 0;
    seenNamesRef.current = new Set();
    void fetchTags(searchQuery, false);
  }, [enabled, searchQuery, fetchTags]);

  // A new query (or a projects/limit change, via fetchTags' identity) starts over
  // at page 0 and replaces the list.
  useEffect(() => {
    if (!enabled) {
      setTags([]);
      setHasMore(false);
      setIsLoading(false);
      setIsLoadingMore(false);
      fetchedCountRef.current = 0;
      seenNamesRef.current = new Set();
      return;
    }

    fetchedCountRef.current = 0;
    seenNamesRef.current = new Set();
    void fetchTags(searchQuery, false);
  }, [searchQuery, enabled, fetchTags]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return { tags, isLoading, isLoadingMore, hasMore, loadMore, error, refetch };
};
