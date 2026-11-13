import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { CredentialListItem } from '@xyne/workflow-sdk';
import { useWorkflowClient } from './use-workflow-client.js';
import { wfKeys } from './queries.js';

const PAGE_SIZE = 50;

export interface UseCredentialListReturn {
  credentials: CredentialListItem[] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * The credential vault's rows, cursor-paged.
 *
 * `credentials` is `null` until the first page arrives: the vault renders
 * "loading" and "none" differently, and an empty array cannot say which.
 */
export function useCredentialList(): UseCredentialListReturn {
  const client = useWorkflowClient();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: wfKeys.credentials(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.credentials.list(
        { limit: PAGE_SIZE, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

  const credentials = useMemo(
    () => query.data?.pages.flatMap((page) => page.credentials) ?? null,
    [query.data],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: wfKeys.credentials() });
  }, [queryClient]);

  return {
    credentials,
    isLoading: query.isPending,
    isLoadingMore: isFetchingNextPage,
    error: query.error,
    hasMore: hasNextPage,
    loadMore,
    refresh,
  };
}
