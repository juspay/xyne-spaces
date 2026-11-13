import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowRecord } from '@xyne/workflow-sdk/client';
import { useWorkflowClient } from './use-workflow-client.js';
import { wfKeys } from './queries.js';

const PAGE_SIZE = 25;

export interface UseWorkflowListReturn {
  workflows: WorkflowRecord[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
  activate: (id: string) => Promise<void>;
  deactivate: (id: string) => Promise<void>;
}

export interface UseWorkflowListOptions {
  folderId?: string | undefined;
  /** Rows per page. Defaults to 25; clamped server-side to `MAX_PAGE`. */
  limit?: number | undefined;
  /** Skip the read — for a screen that is mounted but not showing workflows. */
  enabled?: boolean | undefined;
}

/** Workflows in a folder, cursor-paged. */
export function useWorkflowList(opts?: UseWorkflowListOptions): UseWorkflowListReturn {
  const client = useWorkflowClient();
  const queryClient = useQueryClient();
  const { folderId, limit = PAGE_SIZE, enabled = true } = opts ?? {};

  const key = useMemo(() => wfKeys.workflowList(folderId, limit), [folderId, limit]);

  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.workflows.list(
        {
          limit,
          ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          ...(folderId !== undefined ? { folderId } : {}),
        },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });

  const workflows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const afterLifecycleChange = useCallback(() => {
    // By folder, not by page size: every page size of this folder is stale.
    void queryClient.invalidateQueries({ queryKey: wfKeys.workflowList(folderId) });
    void queryClient.invalidateQueries({ queryKey: wfKeys.workflowCounts() });
  }, [queryClient, folderId]);

  const activate = useCallback(
    async (id: string) => {
      await client.workflows.activate(id);
      afterLifecycleChange();
    },
    [client, afterLifecycleChange],
  );

  const deactivate = useCallback(
    async (id: string) => {
      await client.workflows.deactivate(id);
      afterLifecycleChange();
    },
    [client, afterLifecycleChange],
  );

  return {
    workflows,
    isLoading: enabled && query.isPending,
    isLoadingMore: isFetchingNextPage,
    error: query.error,
    hasMore: enabled && hasNextPage,
    loadMore,
    refetch,
    activate,
    deactivate,
  };
}
