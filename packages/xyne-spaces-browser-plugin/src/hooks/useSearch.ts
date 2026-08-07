/**
 * React hook for search operations.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getSdkClient } from '../lib/sdk-client';
import type { SearchResult } from '@xyne/spaces-sdk';

interface UseSearchOptions {
  debounceMs?: number;
  defaultLimit?: number;
}

interface UseSearchReturn {
  results: SearchResult[];
  total: number;
  isLoading: boolean;
  error: string | null;
  search: (query: string, type?: string | string[]) => Promise<void>;
  clear: () => void;
}

export function useSearch(options: UseSearchOptions = {}): UseSearchReturn {
  const { debounceMs = 300, defaultLimit = 20 } = options;

  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (query: string, type?: string | string[]) => {
      // Clear previous debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Clear results if query is empty
      if (!query.trim()) {
        setResults([]);
        setTotal(0);
        setError(null);
        return;
      }

      // Debounce the search
      debounceRef.current = setTimeout(async () => {
        setIsLoading(true);
        setError(null);

        // Cancel previous request
        if (abortRef.current) {
          abortRef.current.abort();
        }
        abortRef.current = new AbortController();

        try {
          const sdk = await getSdkClient();
          const response = await sdk.search.query({
            q: query,
            type,
            limit: defaultLimit,
          });

          setResults(response.results);
          setTotal(response.total);
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            return; // Ignore aborted requests
          }

          const message = err instanceof Error ? err.message : 'Search failed';
          setError(message);
          setResults([]);
          setTotal(0);
        } finally {
          setIsLoading(false);
        }
      }, debounceMs);
    },
    [debounceMs, defaultLimit]
  );

  const clear = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setResults([]);
    setTotal(0);
    setError(null);
    setIsLoading(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  return {
    results,
    total,
    isLoading,
    error,
    search,
    clear,
  };
}
