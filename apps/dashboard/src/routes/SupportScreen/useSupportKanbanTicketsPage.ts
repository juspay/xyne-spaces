import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Ticket } from '@xyne/shared';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';

const PAGE_SIZE = 20;
const DAY_MS = 86_400_000;
// Same ladder as the project board's createdAt window, on updatedAt. Past the last step the
// query is unbounded, and only that step may conclude a column has no more rows.
const WINDOW_STEPS_MS: readonly number[] = [30 * DAY_MS, 60 * DAY_MS, 180 * DAY_MS, 365 * DAY_MS];
const WINDOW_ANCHOR_QUANTUM_MS = 60 * 60 * 1000;

type SupportKanbanPageQueryArgs = Parameters<typeof queries.supportKanbanTicketsPage>[0];

export type SupportKanbanPageBaseArgs = Omit<
  SupportKanbanPageQueryArgs,
  'stage' | 'otherStageNames' | 'limit' | 'updatedAfter'
>;

type UseSupportKanbanTicketsPageOptions = SupportKanbanPageBaseArgs & {
  stage: string;
  otherStageNames?: string[];
  /** Server count for this column; 0 lets an empty page stop without widening the window. */
  expectedCount?: number;
  enabled?: boolean;
};

type PageState = { key: string; limit: number; windowStep: number; anchor: number };

const initialPageState = (key: string): PageState => ({
  key,
  limit: PAGE_SIZE,
  windowStep: 0,
  anchor: Math.ceil(Date.now() / WINDOW_ANCHOR_QUANTUM_MS) * WINDOW_ANCHOR_QUANTUM_MS,
});

export const useSupportKanbanTicketsPage = ({
  expectedCount,
  enabled = true,
  ...args
}: UseSupportKanbanTicketsPageOptions): {
  tickets: Ticket[];
  isComplete: boolean;
  isSettled: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
} => {
  const key = JSON.stringify(args);
  const [state, setState] = useState<PageState>(() => initialPageState(key));
  const page = useMemo(() => (state.key === key ? state : initialPageState(key)), [key, state]);
  const windowSpan = WINDOW_STEPS_MS[page.windowStep];

  const [rows, details] = useCachedQuery(
    queries.supportKanbanTicketsPage({
      ...args,
      limit: page.limit,
      ...(windowSpan !== undefined ? { updatedAfter: page.anchor - windowSpan } : {}),
    }),
    { enabled },
  );

  const isComplete = details.type === 'complete';
  const rawCount = rows?.length ?? 0;
  const hasMore = rawCount >= page.limit;
  const isWindowBounded = windowSpan !== undefined;

  // Custom-field filters are part of the query (typed columns), so every row returned matches.
  const tickets = useMemo(() => (rows ?? []) as Ticket[], [rows]);

  useEffect(() => {
    // A short page inside a bounded window may just mean the window is too narrow.
    // The step is kept across load-more, so a sparse column only climbs once.
    if (!isComplete || hasMore || !isWindowBounded || (rawCount === 0 && expectedCount === 0))
      return;
    setState({ ...page, windowStep: page.windowStep + 1 });
  }, [expectedCount, hasMore, isComplete, isWindowBounded, page, rawCount]);

  const loadMore = useCallback(() => {
    if (!isComplete || !hasMore) return;
    setState({ ...page, limit: page.limit + PAGE_SIZE });
  }, [hasMore, isComplete, page]);

  return {
    tickets,
    isComplete,
    isSettled:
      isComplete && (hasMore || !isWindowBounded || (rawCount === 0 && expectedCount === 0)),
    hasMore,
    isLoadingMore: !isComplete && page.limit > PAGE_SIZE,
    loadMore,
  };
};
