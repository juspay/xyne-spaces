import { useMemo } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

export type Workflow = QueryResultType<typeof queries.workflowsPaginated>[number];

export interface UseWorkflowsResult {
  workflows: Workflow[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
}

export interface UseWorkflowsParams {
  limit: number;
  start: { id: string; createdAt: number } | null;
  searchQuery?: string | undefined;
  statusFilter?: string[] | undefined;
  workflowTypeFilter?: string[] | undefined;
  createdByFilter?: string[] | undefined;
  assignedToFilter?: string[] | undefined;
  dateRangeFilter?: { startDate: number; endDate: number } | undefined;
}

export function useWorkflows(params: UseWorkflowsParams): UseWorkflowsResult {
  const [workflowsData, queryDetails] = useCachedQuery(
    queries.workflowsPaginated({
      limit: params.limit,
      start: params.start,
      searchQuery: params.searchQuery,
      statusFilter: params.statusFilter,
      workflowTypeFilter: params.workflowTypeFilter,
      createdByFilter: params.createdByFilter,
      assignedToFilter: params.assignedToFilter,
      dateRangeFilter: params.dateRangeFilter,
    }),
  );

  const processed = useMemo(() => {
    if (queryDetails.type === 'unknown') {
      return {
        workflows: [],
        isLoading: true,
        error: null,
        hasMore: false,
      };
    }

    if (queryDetails.type === 'error') {
      return {
        workflows: [],
        isLoading: false,
        error: JSON.stringify(queryDetails.error.details),
        hasMore: false,
      };
    }

    const rows = workflowsData ?? [];
    // OVER-FETCH PATTERN: We request (PAGE_SIZE + 1) items to determine if more data exists.
    // This solves the ambiguity when rows.length === PAGE_SIZE (can't tell if it's exact match or has more).
    // If we get (PAGE_SIZE + 1) items, there's definitely more data. If we get <= PAGE_SIZE, we're at the end.
    const actualLimit = params.limit - 1; // The real page size (e.g., 10 when limit is 11)
    const hasMore = rows.length > actualLimit; // Got the extra item? Then there's more data.
    const workflows = hasMore ? rows.slice(0, actualLimit) : rows; // Show only actualLimit items
    return {
      workflows,
      isLoading: false,
      error: null,
      hasMore,
    };
  }, [workflowsData, queryDetails, params.limit]);

  return processed;
}
