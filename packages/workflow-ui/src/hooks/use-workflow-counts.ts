import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowCounts } from '@xyne/workflow-sdk/client';
import { useWorkflowClient } from './use-workflow-client.js';
import { wfKeys } from './queries.js';

export interface UseWorkflowCountsReturn {
  total: number;
  byFolder: Record<string, { total: number; active: number }>;
  isLoading: boolean;
  refetch: () => void;
}

const EMPTY: WorkflowCounts = { total: 0, byFolder: {} };

/**
 * Total + per-folder workflow counts for the folder rail, computed server-side.
 * One shared key, so the rail and the analytics grid issue one request between them.
 */
export function useWorkflowCounts(): UseWorkflowCountsReturn {
  const client = useWorkflowClient();
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: wfKeys.workflowCounts(),
    queryFn: ({ signal }) => client.workflows.counts({ signal }),
    staleTime: 60_000,
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: wfKeys.workflowCounts() });
  }, [queryClient]);

  const counts = data ?? EMPTY;
  return {
    total: counts.total,
    byFolder: counts.byFolder,
    isLoading: isPending,
    refetch,
  };
}
