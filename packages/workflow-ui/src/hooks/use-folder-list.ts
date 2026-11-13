import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { FolderRecord } from '@xyne/workflow-sdk/client';
import { useWorkflowClient } from './use-workflow-client.js';
import { wfKeys } from './queries.js';

const PAGE_SIZE = 50;

export interface UseFolderListReturn {
  folders: FolderRecord[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
  create: (name: string, parentId?: string | null) => Promise<FolderRecord>;
  rename: (id: string, name: string) => Promise<void>;
  move: (id: string, parentId: string | null) => Promise<void>;
  /** Rejects (e.g. 409 "not empty") if the folder still holds workflows. */
  remove: (id: string) => Promise<void>;
}

/** Folders, cursor-paged. Mutations invalidate rather than refetching locally. */
export function useFolderList(): UseFolderListReturn {
  const client = useWorkflowClient();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: wfKeys.folders(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.folders.list(
        { limit: PAGE_SIZE, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

  const folders = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: wfKeys.folders() });
    void queryClient.invalidateQueries({ queryKey: wfKeys.workflowCounts() });
  }, [queryClient]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const create = useCallback(
    async (name: string, parentId?: string | null) => {
      const folder = await client.folders.create({ name, parentId: parentId ?? null });
      invalidate();
      return folder;
    },
    [client, invalidate],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      await client.folders.update(id, { name });
      invalidate();
    },
    [client, invalidate],
  );

  const move = useCallback(
    async (id: string, parentId: string | null) => {
      await client.folders.update(id, { parentId });
      invalidate();
    },
    [client, invalidate],
  );

  const remove = useCallback(
    async (id: string) => {
      await client.folders.delete(id);
      invalidate();
    },
    [client, invalidate],
  );

  return {
    folders,
    isLoading: query.isPending,
    isLoadingMore: isFetchingNextPage,
    error: query.error,
    hasMore: hasNextPage,
    loadMore,
    refetch: invalidate,
    create,
    rename,
    move,
    remove,
  };
}
