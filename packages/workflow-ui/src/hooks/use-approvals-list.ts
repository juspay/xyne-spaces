import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type {
  PaginatedList,
  PendingApprovalBucket,
  PendingApprovalFacets,
  PendingApprovalSummary,
} from '@xyne/workflow-sdk/client';
import { useWorkflowClient } from './use-workflow-client.js';
import { wfKeys } from './queries.js';

const PAGE_SIZE = 25;

/** The pages this query holds. Named so the placeholder callback can be typed. */
type ApprovalPages = InfiniteData<PaginatedList<PendingApprovalSummary>, string | undefined>;

export interface ApprovalFilters {
  workflowIds?: readonly string[] | undefined;
  stages?: readonly string[] | undefined;
  tags?: readonly string[] | undefined;
  search?: string | undefined;
  sort?: 'newest' | 'oldest' | 'due' | undefined;
  /**
   * Ask for one deadline slice of the queue.
   *
   * A section shows its bucket by REQUESTING it, never by grouping a page it
   * happens to hold: a page is 25 rows, and the gate due this afternoon may be
   * the 900th in raised order — exactly where a first page never reaches.
   */
  bucket?: PendingApprovalBucket | undefined;
  /**
   * End of the reader's day, epoch ms — see `endOfToday()`. Required by
   * `bucket: 'dueToday'` and ignored otherwise.
   *
   * Pass a value that is STABLE across renders. It is part of the cache key,
   * so a freshly computed one each render would make every render a new
   * question and refetch forever.
   */
  dayEnd?: number | undefined;
}

export interface UseApprovalsListReturn {
  approvals: PendingApprovalSummary[];
  /** Counts over the whole visible set, not the page in hand. */
  facets: PendingApprovalFacets | undefined;
  /** First load only — false while a filter change is in flight. */
  isLoading: boolean;
  /** Any read in flight, for a non-destructive busy hint. */
  isRefreshing: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  /** Drop a resolved row locally; the answer is already known. */
  /** Drops a resolved gate's row; without a nodePath, every row of the run. */
  remove: (executionId: string, nodePath?: string) => void;
}

/**
 * The approvals inbox: one page of rows, plus the facets its filters offer.
 *
 * Every filter is a query parameter, so a filter change is a new page rather
 * than a re-derivation over rows held in memory. Facets are a separate query
 * because they describe the whole set while the list shows one page of it.
 */
export function useApprovalsList(filters: ApprovalFilters = {}): UseApprovalsListReturn {
  const client = useWorkflowClient();
  const queryClient = useQueryClient();

  const { workflowIds, stages, tags, search, sort, bucket, dayEnd } = filters;
  const key = useMemo(
    () => wfKeys.approvalList({ workflowIds, stages, tags, search, sort, bucket, dayEnd }),
    [workflowIds, stages, tags, search, sort, bucket, dayEnd],
  );

  const query = useInfiniteQuery({
    queryKey: key,
    // Hold the visible page while a filter or keystroke settles — without it
    // `isPending` goes true on every change and a caller gating on it unmounts
    // its own search box.
    //
    // But NEVER hold it across a bucket change. Overdue's rows sitting under
    // the "Due today" pill is not a stale view, it is a false statement, and it
    // lasts as long as the fetch does. The bucket is the second-to-last segment
    // of the key built by `wfKeys.approvalList` — asserted in this hook's test,
    // so a key reshuffle fails loudly rather than silently reviving this.
    placeholderData: (previous: ApprovalPages | undefined, previousQuery): ApprovalPages | undefined => {
      const previousBucket =
        (previousQuery?.queryKey as readonly unknown[] | undefined)?.at(-2) ?? null;
      return previousBucket === (bucket ?? null) ? previous : undefined;
    },
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.executions.listPendingApprovals(
        {
          limit: PAGE_SIZE,
          ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          ...(workflowIds && workflowIds.length > 0 ? { workflowIds } : {}),
          ...(stages && stages.length > 0 ? { stages } : {}),
          ...(tags && tags.length > 0 ? { tags } : {}),
          ...(search ? { search } : {}),
          ...(sort ? { sort } : {}),
          ...(bucket ? { bucket } : {}),
          ...(dayEnd !== undefined ? { dayEnd } : {}),
        },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

  const { data: facets } = useQuery({
    queryKey: wfKeys.approvalFacets(),
    queryFn: ({ signal }) => client.executions.pendingApprovalFacets({ signal }),
    staleTime: 60_000,
  });

  const approvals = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: wfKeys.approvals() });
  }, [queryClient]);

  const remove = useCallback(
    (executionId: string, nodePath?: string) => {
      // Every cached filter combination, so it cannot reappear on a filter flip.
      queryClient.setQueriesData<{
        pages: Array<{ items: PendingApprovalSummary[]; nextCursor?: string }>;
        pageParams: unknown[];
      }>({ queryKey: wfKeys.approvals() }, (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            // A run parked at parallel gates is one row per gate; resolving
            // one gate must leave its siblings in the queue.
            items: page.items.filter(
              (row) =>
                row.id !== executionId ||
                (nodePath !== undefined && row.pausedNodePath !== nodePath),
            ),
          })),
        };
      });
      void queryClient.invalidateQueries({ queryKey: wfKeys.approvalCount() });
      void queryClient.invalidateQueries({ queryKey: wfKeys.approvalFacets() });
    },
    [queryClient],
  );

  return {
    approvals,
    facets,
    isLoading: query.isPending,
    isRefreshing: query.isFetching,
    isLoadingMore: isFetchingNextPage,
    error: query.error,
    hasMore: hasNextPage,
    loadMore,
    refresh,
    remove,
  };
}
