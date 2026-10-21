import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Ticket } from '@xyne/shared';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import {
  ticketMatchesDynamicFieldEntries,
  type DynamicFieldFilterEntry,
  type FormEntityValueLike,
} from '../../utils/board/dynamicFieldFilters';

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
  dynamicFieldEntries?: DynamicFieldFilterEntry[];
  /** Server count for this column; 0 lets an empty page stop without widening the window. */
  expectedCount?: number;
  enabled?: boolean;
};

type PageState = { key: string; limit: number; target: number; windowStep: number; anchor: number };

const initialPageState = (key: string): PageState => ({
  key,
  limit: PAGE_SIZE,
  target: PAGE_SIZE,
  windowStep: 0,
  anchor: Math.ceil(Date.now() / WINDOW_ANCHOR_QUANTUM_MS) * WINDOW_ANCHOR_QUANTUM_MS,
});

export const useSupportKanbanTicketsPage = ({
  dynamicFieldEntries,
  expectedCount,
  enabled = true,
  ...args
}: UseSupportKanbanTicketsPageOptions): {
  tickets: Ticket[];
  isComplete: boolean;
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

  // Dynamic-field entries are matched client-side, so a page can come back mostly hidden.
  // Keep raising the limit until the visible rows reach the target or the column runs out.
  const tickets = useMemo(() => {
    const all = (rows ?? []) as Ticket[];
    if (!dynamicFieldEntries?.length) return all;
    return all.filter(ticket =>
      ticketMatchesDynamicFieldEntries(
        (ticket as Ticket & { formEntityValues?: FormEntityValueLike[] }).formEntityValues,
        dynamicFieldEntries,
      ),
    );
  }, [rows, dynamicFieldEntries]);

  useEffect(() => {
    if (!isComplete) return;
    if (!hasMore) {
      // A short page inside a bounded window may just mean the window is too narrow.
      // The step is kept across load-more, so a sparse column only climbs once.
      if (isWindowBounded && !(rawCount === 0 && expectedCount === 0)) {
        setState({ ...page, windowStep: page.windowStep + 1 });
      }
      return;
    }
    if (tickets.length < page.target) setState({ ...page, limit: page.limit + PAGE_SIZE });
  }, [expectedCount, hasMore, isComplete, isWindowBounded, page, rawCount, tickets.length]);

  const loadMore = useCallback(() => {
    if (!isComplete || !hasMore) return;
    setState({ ...page, limit: page.limit + PAGE_SIZE, target: tickets.length + PAGE_SIZE });
  }, [hasMore, isComplete, page, tickets.length]);

  return {
    tickets,
    isComplete,
    hasMore,
    isLoadingMore: !isComplete && page.limit > PAGE_SIZE,
    loadMore,
  };
};
