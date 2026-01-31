import { useMemo, useState, useEffect } from 'react';
import { apiInstance } from '../services/clients/apiClient';
import type { WorkflowTypesAPIResponse } from '../components/Tickets/types';

export type WorkflowType = WorkflowTypesAPIResponse['workflowTypes'][number];

export interface UseWorkflowTypesResult {
  workflowTypes: WorkflowType[];
  isLoading: boolean;
  error: string | null;
}

// Global cache for workflow types with TTL
let workflowTypesCache: {
  data: WorkflowType[] | null;
  timestamp: number;
  promise: Promise<WorkflowType[]> | null;
} | null = null;

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const STALE_TIME = 5 * 60 * 1000; // 5 minutes - consider stale after this but still use cache

/**
 * Hook to fetch and cache workflow types globally
 * Uses manual caching with TTL to avoid repeated API calls
 */
export const useWorkflowTypes = (): UseWorkflowTypesResult => {
  const [state, setState] = useState<{
    workflowTypes: WorkflowType[];
    isLoading: boolean;
    error: string | null;
  }>({
    workflowTypes: [],
    isLoading: false,
    error: null,
  });

  const fetchWorkflowTypes = useMemo(
    () => async (): Promise<WorkflowType[]> => {
      try {
        const response = await apiInstance.get<WorkflowTypesAPIResponse>('/workflows/types');
        return response.data.workflowTypes || [];
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Failed to fetch workflow types',
        );
      }
    },
    [],
  );

  useEffect(() => {
    const now = Date.now();

    // Check if we have valid cached data
    if (
      workflowTypesCache &&
      workflowTypesCache.data &&
      now - workflowTypesCache.timestamp < CACHE_TTL
    ) {
      setState({
        workflowTypes: workflowTypesCache.data,
        isLoading: false,
        error: null,
      });
      return;
    }

    // Check if we have a pending request
    if (workflowTypesCache?.promise) {
      setState(prev => ({ ...prev, isLoading: true }));

      workflowTypesCache.promise
        .then(data => {
          setState({
            workflowTypes: data,
            isLoading: false,
            error: null,
          });
        })
        .catch((error: unknown) => {
          const errorMessage =
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : 'Failed to fetch workflow types';
          setState({
            workflowTypes: [],
            isLoading: false,
            error: errorMessage,
          });
        });
      return;
    }

    // Fetch new data
    const promise = fetchWorkflowTypes();

    // Update cache with promise and timestamp
    workflowTypesCache = {
      data: null,
      timestamp: now,
      promise,
    };

    setState(prev => ({ ...prev, isLoading: true }));

    promise
      .then(data => {
        // Update cache with actual data
        if (workflowTypesCache) {
          workflowTypesCache.data = data;
          workflowTypesCache.promise = null;
        }

        setState({
          workflowTypes: data,
          isLoading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        // Clear cache on error
        workflowTypesCache = null;

        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Failed to fetch workflow types';
        setState({
          workflowTypes: [],
          isLoading: false,
          error: errorMessage,
        });
      });
  }, [fetchWorkflowTypes]);

  return state;
};

/**
 * Function to preload workflow types - useful for app initialization
 */
export const preloadWorkflowTypes = async (): Promise<void> => {
  const now = Date.now();

  // Only preload if cache is stale or doesn't exist
  if (
    !workflowTypesCache ||
    !workflowTypesCache.data ||
    now - workflowTypesCache.timestamp > STALE_TIME
  ) {
    const response = await apiInstance.get<WorkflowTypesAPIResponse>('/workflows/types');
    workflowTypesCache = {
      data: response.data.workflowTypes || [],
      timestamp: now,
      promise: null,
    };
  }
};

/**
 * Function to clear workflow types cache - useful when workflow types are updated
 */
export const clearWorkflowTypesCache = (): void => {
  workflowTypesCache = null;
};
