/**
 * Research Agent Hooks
 * React Query hooks for fetching products and repositories from Research Agent
 */

import { useQuery } from '@tanstack/react-query';
import { fetchProducts, fetchRepositories } from '../../../../services/researchAgentService';
import type { ResearchProduct, ResearchRepository, ResearchContext } from '@xyne/shared';

// Re-export types for convenience
export type { ResearchProduct, ResearchRepository, ResearchContext };

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch available products from Research Agent
 * @param enabled - Whether to automatically fetch (default: true for backward compatibility)
 */
export function useResearchProducts(enabled = true) {
  return useQuery({
    queryKey: ['research-agent', 'products'],
    queryFn: fetchProducts,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: 2,
    refetchOnWindowFocus: false,
    enabled, // Only fetch when enabled
  });
}

/**
 * Hook to fetch available repositories from Research Agent
 * @param enabled - Whether to automatically fetch (default: true for backward compatibility)
 */
export function useResearchRepositories(enabled = true) {
  return useQuery({
    queryKey: ['research-agent', 'repositories'],
    queryFn: fetchRepositories,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: 2,
    refetchOnWindowFocus: false,
    enabled,
  });
}

/**
 * Combined hook for both products and repositories
 * Lazy-loaded: data is only fetched when triggerFetch is called
 */
export function useResearchOptions() {
  const products = useResearchProducts(false); // Disabled by default
  const repositories = useResearchRepositories(false); // Disabled by default

  const hasFetched = products.isFetched || repositories.isFetched;

  return {
    products: products.data ?? [],
    repositories: repositories.data ?? [],
    isLoading: products.isFetching || repositories.isFetching,
    isError: products.isError || repositories.isError,
    error: products.error || repositories.error,
    hasFetched,
    triggerFetch: () => {
      void products.refetch();
      void repositories.refetch();
    },
    refetch: () => {
      void products.refetch();
      void repositories.refetch();
    },
  };
}
