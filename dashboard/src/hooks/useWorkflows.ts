import { useMemo } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

export type Workflow = QueryResultType<typeof queries.allWorkflows>[number];

export interface UseWorkflowsResult {
  workflows: Workflow[];
  isLoading: boolean;
  error: string | null;
  totalCount: number;
}

export function useWorkflows(): UseWorkflowsResult {
  const [workflowsData, queryDetails] = useCachedQuery(queries.allWorkflows());

  const processed = useMemo(() => {
    // Loading
    if (queryDetails.type === 'unknown') {
      return {
        workflows: [],
        isLoading: true,
        error: null,
        totalCount: 0,
      };
    }

    // Error
    if (queryDetails.type === 'error') {
      return {
        workflows: [],
        isLoading: false,
        error: JSON.stringify(queryDetails.error.details),
        totalCount: 0,
      };
    }

    // Success
    const rows = workflowsData ?? [];
    return {
      workflows: rows,
      isLoading: false,
      error: null,
      totalCount: rows.length,
    };
  }, [workflowsData, queryDetails]);

  return processed;
}
