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

type SupportKanbanPageQueryArgs = Parameters<typeof queries.supportKanbanTicketsPage>[0];

export type SupportKanbanPageBaseArgs = Omit<
  SupportKanbanPageQueryArgs,
  'stage' | 'otherStageNames' | 'limit'
>;

type UseSupportKanbanTicketsPageOptions = SupportKanbanPageBaseArgs & {
  stage: string;
  otherStageNames?: string[];
  dynamicFieldEntries?: DynamicFieldFilterEntry[];
  enabled?: boolean;
};

type PageState = { key: string; limit: number; target: number };

export const useSupportKanbanTicketsPage = ({
  dynamicFieldEntries,
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
  const [state, setState] = useState<PageState>({ key, limit: PAGE_SIZE, target: PAGE_SIZE });
  const page = useMemo(
    () => (state.key === key ? state : { key, limit: PAGE_SIZE, target: PAGE_SIZE }),
    [key, state],
  );

  const [rows, details] = useCachedQuery(
    queries.supportKanbanTicketsPage({ ...args, limit: page.limit }),
    { enabled },
  );

  const isComplete = details.type === 'complete';
  const rawCount = rows?.length ?? 0;
  const hasMore = rawCount >= page.limit;

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
    if (!isComplete || !hasMore || tickets.length >= page.target) return;
    setState({ ...page, limit: page.limit + PAGE_SIZE });
  }, [hasMore, isComplete, page, tickets.length]);

  const loadMore = useCallback(() => {
    if (!isComplete || !hasMore) return;
    setState({ key, limit: page.limit + PAGE_SIZE, target: tickets.length + PAGE_SIZE });
  }, [hasMore, isComplete, key, page.limit, tickets.length]);

  return {
    tickets,
    isComplete,
    hasMore,
    isLoadingMore: !isComplete && page.limit > PAGE_SIZE,
    loadMore,
  };
};
