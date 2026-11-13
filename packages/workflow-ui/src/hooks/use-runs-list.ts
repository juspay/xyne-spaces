import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { ExecutionRecord } from '@xyne/workflow-sdk/client';
import { useWorkflowClient } from './use-workflow-client.js';
import { wfKeys } from './queries.js';
import { useLiveRuns, useLiveRootRuns } from '../live/use-live-workflow.js';
import type { LiveTopic } from '../live/live-context.js';

const PAGE_SIZE = 25;

export interface UseRunsListOptions {
  workflowId?: string;
  status?: string;
  folderId?: string;
}

export interface UseRunsListReturn {
  executions: ExecutionRecord[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
  trigger: (workflowId: string, payload?: Record<string, unknown>) => Promise<{ executionId: string }>;
}

/** A workflow's runs, cursor-paged and invalidated by `run_changed`. */
export function useRunsList(opts: UseRunsListOptions = {}): UseRunsListReturn {
  const { workflowId, status, folderId } = opts;
  const client = useWorkflowClient();
  const queryClient = useQueryClient();

  const key = useMemo(
    () => wfKeys.runList({ workflowId, status, folderId }),
    [workflowId, status, folderId],
  );

  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.executions.list(
        {
          limit: PAGE_SIZE,
          ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          ...(workflowId !== undefined ? { workflowId } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(folderId !== undefined ? { folderId } : {}),
        },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

  // Narrowest topic covering this list. A scoped list watches its workflow or
  // folder and invalidates; an unscoped list watches the whole root scope and
  // patches the cache in place (no refetch) via useLiveRootRuns.
  const scope = useMemo<LiveTopic | undefined>(() => {
    if (workflowId) return { kind: 'workflow', id: workflowId };
    if (folderId) return { kind: 'folder', id: folderId };
    return undefined;
  }, [workflowId, folderId]);
  useLiveRuns(scope);
  useLiveRootRuns(!workflowId && !folderId);

  const executions = useMemo(
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

  const triggerExec = useCallback(
    async (wfId: string, payload?: Record<string, unknown>) => {
      const result = await client.workflows.trigger(wfId, payload);
      // Also invalidate directly, so the row appears without the live layer.
      void queryClient.invalidateQueries({ queryKey: wfKeys.runs() });
      return result;
    },
    [client, queryClient],
  );

  return {
    executions,
    isLoading: query.isPending,
    isLoadingMore: isFetchingNextPage,
    error: query.error,
    hasMore: hasNextPage,
    loadMore,
    refetch,
    trigger: triggerExec,
  };
}
