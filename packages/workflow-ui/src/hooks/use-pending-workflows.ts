import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { PendingWorkflowSummary } from '@xyne/workflow-sdk';
import { useWorkflowClient } from './use-workflow-client.js';
import { wfKeys } from './queries.js';

const PAGE_SIZE = 25;

export interface UsePendingWorkflowsReturn {
  items: PendingWorkflowSummary[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  /** Drop a decided row locally; the answer is already known. */
  remove: (workflowId: string) => void;
}

/**
 * Workflows awaiting review, cursor-paged.
 *
 * Scoped to what the caller can SEE, not what they can approve — an author
 * watches their own submissions here. `permittedActions` per row gates Approve.
 */
export function usePendingWorkflows(): UsePendingWorkflowsReturn {
  const client = useWorkflowClient();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: wfKeys.pendingWorkflows(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.workflows.listPending(
        { limit: PAGE_SIZE, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: wfKeys.pendingWorkflows() });
  }, [queryClient]);

  const remove = useCallback(
    (workflowId: string) => {
      queryClient.setQueriesData<{
        pages: Array<{ items: PendingWorkflowSummary[]; nextCursor?: string }>;
        pageParams: unknown[];
      }>({ queryKey: wfKeys.pendingWorkflows() }, (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.filter((row) => row.workflowId !== workflowId),
          })),
        };
      });
      void queryClient.invalidateQueries({ queryKey: wfKeys.workflow(workflowId) });
    },
    [queryClient],
  );

  return {
    items,
    isLoading: query.isPending,
    isLoadingMore: isFetchingNextPage,
    error: query.error,
    hasMore: hasNextPage,
    loadMore,
    refresh,
    remove,
  };
}
