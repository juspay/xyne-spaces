import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnalyticsSummaryResult, ApprovalAnalyticsResult } from '@xyne/workflow-sdk/client';
import { useWorkflowClient } from './use-workflow-client.js';
import { wfKeys } from './queries.js';

export type AnalyticsRange = 7 | 14 | 30;

export interface AnalyticsData {
  totalRuns: number;
  successRate: number;
  byStatus: Record<string, number>;
  runsByDay: Array<{
    date: string;
    COMPLETED: number;
    FAILED: number;
    RUNNING: number;
    CANCELLED: number;
  }>;
  byWorkflow: Array<{
    workflowId: string;
    name: string;
    status: string;
    eventType: string;
    totalRuns: number;
    failedRuns: number;
    failureRate: number;
    lastRunAt: Date | null;
  }>;
  recentFailures: Array<{
    executionId: string;
    workflowId: string;
    workflowName: string;
    createdAt: Date;
  }>;
  activeWorkflows: number;
  totalWorkflows: number;
}

export interface UseAnalyticsReturn {
  data: AnalyticsData | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

function fromSummary(summary: AnalyticsSummaryResult): AnalyticsData {
  return {
    ...summary,
    byWorkflow: summary.byWorkflow.map((wf) => ({
      ...wf,
      lastRunAt: wf.lastRunAt ? new Date(wf.lastRunAt) : null,
    })),
    recentFailures: summary.recentFailures.map((f) => ({
      ...f,
      createdAt: new Date(f.createdAt),
    })),
  };
}

export interface UseAnalyticsOptions {
  /** Re-read when the window regains focus. Defaults to true. */
  refreshOnFocus?: boolean;
}

export function useAnalytics(
  range: AnalyticsRange,
  folderId?: string,
  opts: UseAnalyticsOptions = {},
): UseAnalyticsReturn {
  const { refreshOnFocus = true } = opts;
  const client = useWorkflowClient();
  const queryClient = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: wfKeys.analytics(range, folderId),
    queryFn: async ({ signal }) => {
      const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString();
      return fromSummary(
        await client.analytics.summary(
          { since, rangeDays: range, ...(folderId !== undefined ? { folderId } : {}) },
          { signal },
        ),
      );
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: refreshOnFocus,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: wfKeys.analytics(range, folderId) });
  }, [queryClient, range, folderId]);

  return { data: data ?? null, isLoading: isPending, error, refresh };
}

/**
 * On-time vs late for approvals decided since `since` (ISO). `since` must be
 * stable per mount — it is part of the cache key.
 */
export function useApprovalAnalytics(since: string): {
  data: ApprovalAnalyticsResult | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const client = useWorkflowClient();
  const { data, isPending, error } = useQuery({
    queryKey: wfKeys.approvalAnalytics(since),
    queryFn: ({ signal }) => client.analytics.approvals({ since }, { signal }),
    staleTime: 5 * 60_000,
  });
  return { data, isLoading: isPending, error };
}
