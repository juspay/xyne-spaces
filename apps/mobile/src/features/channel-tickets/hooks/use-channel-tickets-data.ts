import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

import { useIsChannelMember } from '../load';
import { buildChannelTicketsPageArgs, channelTicketsFiltersKey } from '../query-args';
import type { ChannelTicketRow, ChannelTicketsFilters } from '../types';
import {
  clearChannelTicketsPaintCache,
  computeChannelTicketsPaging,
  filterChannelTicketRowsByBoard,
  getChannelTicketsPaintCache,
  mapChannelTicketRows,
  nextChannelTicketsPages,
  setChannelTicketsPaintCache,
  shouldAutoGrowForClientFilter,
  type ChannelTicketSourceRow,
} from '../utils';

export type UseChannelTicketsDataReturn = {
  rows: ChannelTicketRow[];
  isEmpty: boolean;
  isInitialLoading: boolean;
  isMember: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
};

type PagesState = { key: string; pages: number };

/**
 * Channel tickets — local-first / optimistic, single live query:
 * - supportTicketsPageV3 with a growing window (PAGE_SIZE * pages + 1 sentinel)
 * - isMember from channel_user_status (required by TicketsACL)
 * - archived / Support rows dropped client-side; board filter client-side
 * - paint cache keyed by session + channel, unfiltered first page only
 */
export function useChannelTicketsData(
  channelId: string,
  filters: ChannelTicketsFilters,
): UseChannelTicketsDataReturn {
  const { workspaceSessionKey: sessionKey } = useAuth();
  const isMember = useIsChannelMember(channelId);

  const filtersKey = channelTicketsFiltersKey(filters);
  const windowKey = `${channelId}\0${filtersKey}`;

  // Pages are stored with the key they belong to; a channel / filter change
  // implicitly resets to one page without an effect + extra render.
  const [pagesState, setPagesState] = useState<PagesState>({ key: windowKey, pages: 1 });
  const pages = pagesState.key === windowKey ? pagesState.pages : 1;

  const args = useMemo(
    () => buildChannelTicketsPageArgs(channelId, isMember, filters, pages),
    // filtersKey stands in for the (possibly fresh) filter arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelId, isMember, filtersKey, pages],
  );

  const [page, pageDetails] = useCachedQuery(queries.supportTicketsPageV3(args), {
    enabled: Boolean(channelId),
    ttl: '10m',
  });

  const isComplete = pageDetails.type === 'complete';
  const receivedCount = page?.length ?? 0;

  const paging = useMemo(
    () => computeChannelTicketsPaging({ pages, receivedCount, isComplete }),
    [pages, receivedCount, isComplete],
  );

  // Age / urgency are day-granular; a per-result "now" is precise enough and keeps
  // the mapper pure and memoisable.
  const liveRows = useMemo(() => {
    const sourceRows = ((page ?? []) as readonly ChannelTicketSourceRow[]).slice(
      0,
      paging.visibleLimit,
    );
    return mapChannelTicketRows(sourceRows, { now: Date.now() });
  }, [page, paging.visibleLimit]);

  const hasServerFilter = filtersKey !== channelTicketsFiltersKey({});
  const hasBoardFilter = filters.boardIds.length > 0;
  const isUnfilteredFirstPage = !hasServerFilter && !hasBoardFilter && pages === 1;

  const paintSeed = useMemo(
    () => (isUnfilteredFirstPage ? getChannelTicketsPaintCache(sessionKey, channelId) : []),
    [sessionKey, channelId, isUnfilteredFirstPage],
  );
  const lastGoodRef = useRef<ChannelTicketRow[]>(paintSeed);

  useEffect(() => {
    lastGoodRef.current = paintSeed;
  }, [paintSeed]);

  useEffect(() => {
    if (!isUnfilteredFirstPage) {
      lastGoodRef.current = liveRows;
      return;
    }
    if (liveRows.length > 0) {
      lastGoodRef.current = liveRows;
      setChannelTicketsPaintCache(sessionKey, channelId, liveRows);
      return;
    }
    if (isComplete) {
      lastGoodRef.current = [];
      clearChannelTicketsPaintCache(sessionKey, channelId);
    }
  }, [liveRows, sessionKey, channelId, isComplete, isUnfilteredFirstPage]);

  const fallback = lastGoodRef.current.length > 0 ? lastGoodRef.current : paintSeed;
  const baseRows =
    liveRows.length > 0 ? liveRows : !isComplete && fallback.length > 0 ? fallback : liveRows;

  const rows = useMemo(
    () => filterChannelTicketRowsByBoard(baseRows, filters.boardIds),
    // boardIds identity is stable per selection (see useChannelTicketsFilters).
    [baseRows, filters.boardIds],
  );

  const loadMore = useCallback(() => {
    setPagesState(prev => {
      const current = prev.key === windowKey ? prev.pages : 1;
      const next = nextChannelTicketsPages(current, paging);
      return next === current && prev.key === windowKey ? prev : { key: windowKey, pages: next };
    });
  }, [windowKey, paging]);

  // A sparse board must not look empty while the server still has rows.
  useEffect(() => {
    if (!isComplete) return;
    if (shouldAutoGrowForClientFilter(rows.length, hasBoardFilter, paging)) loadMore();
  }, [isComplete, rows.length, hasBoardFilter, paging, loadMore]);

  const isInitialLoading = rows.length === 0 && !isComplete;
  const isEmpty = rows.length === 0 && isComplete && !paging.hasMore;

  return {
    rows,
    isEmpty,
    isInitialLoading,
    isMember,
    hasMore: paging.hasMore,
    isLoadingMore: paging.isLoadingMore,
    loadMore,
  };
}
