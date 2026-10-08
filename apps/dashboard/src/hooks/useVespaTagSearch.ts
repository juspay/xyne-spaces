import { useCallback, useEffect, useRef, useState } from 'react';
import { searchService } from '../services/searchService';

const DEFAULT_LIMIT = 100;

interface UseVespaTagSearchParams {
  projectId?: string | undefined;
  boardIds?: string[] | undefined;
  searchQuery?: string | undefined;
  enabled?: boolean | undefined;
  limit?: number | undefined;
}

interface UseVespaTagSearchResult {
  tags: string[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook for searching ticket tags via Vespa.
 * Note: Caller should debounce searchQuery changes - this hook fetches immediately.
 */
export const useVespaTagSearch = ({
  projectId,
  boardIds,
  searchQuery = '',
  enabled = true,
  limit = DEFAULT_LIMIT,
}: UseVespaTagSearchParams): UseVespaTagSearchResult => {
  const [tags, setTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchTags = useCallback(
    async (query: string) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsLoading(true);

      try {
        const result = await searchService.searchTags(
          {
            projectId,
            boardIds,
            query: query || undefined,
            limit,
          },
          abortController.signal,
        );

        if (!abortController.signal.aborted) {
          setTags(result.tags);
          setError(null);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          setError(err instanceof Error ? err : new Error('Failed to fetch tags'));
          setTags([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [projectId, boardIds, limit],
  );

  const refetch = useCallback(() => {
    if (!enabled) return;
    void fetchTags(searchQuery);
  }, [enabled, searchQuery, fetchTags]);

  // Fetch immediately when searchQuery or enabled changes (no internal debounce)
  useEffect(() => {
    if (!enabled) {
      setTags([]);
      setIsLoading(false);
      return;
    }

    void fetchTags(searchQuery);
  }, [searchQuery, enabled, fetchTags]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return { tags, isLoading, error, refetch };
};
