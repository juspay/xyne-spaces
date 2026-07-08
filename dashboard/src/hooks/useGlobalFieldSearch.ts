import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useDebouncedValue } from './useDebouncedValue';
import { formService } from '../services/Form/formService';

export interface UseGlobalFieldSearchOptions {
  limit?: number;
  enabled?: boolean;
  debounceMs?: number;
  minQueryLength?: number;
}

export const useGlobalFieldSearch = (
  projectId: string | undefined,
  searchQuery: string,
  options?: UseGlobalFieldSearchOptions,
) => {
  const limit = options?.limit ?? 10;
  const debounceMs = options?.debounceMs ?? 300;
  const minQueryLength = options?.minQueryLength ?? 1;
  const trimmedQuery = searchQuery.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, debounceMs);
  const enabled = (options?.enabled ?? true) && Boolean(projectId);

  const query = useQuery({
    queryKey: ['global-fields', projectId],
    queryFn: () => {
      if (!projectId) {
        return Promise.resolve([]);
      }
      return formService.getGlobalFields({ projectId });
    },
    enabled,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const results = useMemo(() => {
    if (debouncedQuery.length < minQueryLength) {
      return [];
    }
    const normalizedQuery = debouncedQuery.toLowerCase();
    return (query.data ?? [])
      .filter(field => field.fieldName.toLowerCase().includes(normalizedQuery))
      .slice(0, limit);
  }, [debouncedQuery, limit, minQueryLength, query.data]);

  return {
    results,
    details: query,
    debouncedQuery,
    isSearching: enabled && query.isFetching,
  };
};
