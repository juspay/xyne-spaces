/**
 * Research Agent Service
 * Handles API calls to fetch products and repositories from the Research Agent
 */

import { apiInstance } from './clients/apiClient';
import type { ResearchProduct, ResearchRepository } from '@xyne/shared';

// ============================================================================
// API Response Types
// ============================================================================

interface ProductListResponse {
  data: ResearchProduct[];
}

interface RepositoryListResponse {
  data: ResearchRepository[];
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Fetch available products from Research Agent API
 */
export async function fetchProducts(): Promise<ResearchProduct[]> {
  const response = await apiInstance.get<ProductListResponse | ResearchProduct[]>(
    '/xyne-ai/list-products',
  );

  // Handle both wrapped and unwrapped response formats
  if (Array.isArray(response.data)) {
    return response.data;
  }

  return response.data.data;
}

/**
 * Fetch available repositories from Research Agent API
 */
export async function fetchRepositories(): Promise<ResearchRepository[]> {
  const response = await apiInstance.get<RepositoryListResponse | ResearchRepository[]>(
    '/xyne-ai/list-repositories',
  );

  // Handle both wrapped and unwrapped response formats
  if (Array.isArray(response.data)) {
    return response.data;
  }

  return response.data.data;
}
