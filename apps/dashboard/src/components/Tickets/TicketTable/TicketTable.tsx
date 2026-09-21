import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Ticket, TicketTag } from '@xyne/shared';
import { isDeskChannelType, TicketStatusV2 } from '@xyne/shared';
import { useCachedQuery } from '@xyne/shared/hooks';
import { toast } from 'sonner';
import { queries } from '../../../zero/queries';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { TicketListRow, type SubTicketProgress } from './TicketListRow';
import { BulkActionToolbar } from './BulkActionToolbar';
import {
  dueDateToEta,
  MAX_BULK_TICKETS,
  sharedChannelId,
  useBulkAssignableUsers,
  useBulkTicketActions,
  type BulkTicketUpdates,
} from './useBulkTicketActions';
import { assigneeOptionToTicketUpdate } from './TicketTableHelper';
import { useNavigate } from 'react-router-dom';
import { usePlatform } from '../../../hooks/usePlatform';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { useAllChannels } from '../../../hooks/useChannels';
import { useShortcut } from '../../../shortcuts';

interface TicketTableProps {
  tickets: Ticket[];
  ticketTags?: Map<string, TicketTag[]>;
  availableTags?: string[];
  onRowClick?: (ticket: Ticket) => void;
  onTitleClick?: (ticket: Ticket) => void;
  visibleColumns?: Set<string>;
  isComfortView?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (tickets: Ticket[]) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  isLoading?: boolean;
  onLoadMore?: () => void;
  totalCount?: number;
  /** Scrolling ancestor driving virtualization; absent = own scroll container. */
  scrollElement?: HTMLElement | null;
  /** 'scroll' (default) = infinite scroll; 'pages' = numbered pager (desk). */
  paginationMode?: 'scroll' | 'pages';
  pageSize?: number;
}

// The registry already skips editable targets; these guards cover the rest.
// j/k must not fight an open overlay; Enter must never double-fire on a
// focused control (the control's own activation wins).
const isInsideOverlay = (): boolean => {
  const el = document.activeElement;
  return (
    el instanceof HTMLElement &&
    !!el.closest(
      '[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]',
    )
  );
};
const isActivatableFocused = (): boolean => {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  const tag = el.tagName;
  return tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button';
};

const ROW_HEIGHT_COMPACT = 40;
const ROW_HEIGHT_COMFORT = 52;
const TRAILING_ROW_HEIGHT = 44;
const LOAD_MORE_REMAINING_ROWS = 8;

export const TicketTable: React.FC<TicketTableProps> = ({
  tickets,
  ticketTags,
  availableTags = [],
  onRowClick,
  onTitleClick,
  isComfortView = false,
  visibleColumns = new Set(['assignee', 'dueDate', 'status', 'priority', 'stage', 'tags']),
  selectedIds,
  onSelectionChange,
  hasMore = false,
  isLoadingMore = false,
  isLoading = false,
  onLoadMore,
  totalCount,
  scrollElement,
  paginationMode = 'scroll',
  pageSize = 25,
}) => {
  const isPagesMode = paginationMode === 'pages';
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const { baseRoute, buildChannelRoute } = useRouteContext();

  // Aggregate ticket lists mix channels, so resolve each row's channel type to
  // route desk/support tickets to the Support desk instead of the chat panel.
  const allChannels = useAllChannels();
  const channelsById = useMemo(() => new Map(allChannels.map(c => [c.id, c])), [allChannels]);

  const { applyUpdates, applyTags } = useBulkTicketActions();
  const userGroups = useUserGroups();

  const [selected, setSelected] = useState<Map<string, Ticket>>(new Map());
  const bulkChannelId = useMemo(() => sharedChannelId(Array.from(selected.values())), [selected]);
  const bulkAssignableUsers = useBulkAssignableUsers(bulkChannelId);

  const emitSelection = useCallback(
    (next: Map<string, Ticket>) => {
      setSelected(next);
      onSelectionChange?.(Array.from(next.values()));
    },
    [onSelectionChange],
  );

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const toggleSelect = useCallback(
    (ticket: Ticket) => {
      const next = new Map(selectedRef.current);
      if (next.has(ticket.id)) next.delete(ticket.id);
      else next.set(ticket.id, ticket);
      setSelected(next);
      onSelectionChange?.(Array.from(next.values()));
    },
    [onSelectionChange],
  );

  const selectedIdsKey = selectedIds ? Array.from(selectedIds).sort().join(',') : null;
  useEffect(() => {
    if (selectedIds === undefined) return;
    setSelected(prev => {
      const next = new Map<string, Ticket>();
      for (const ticket of tickets) if (selectedIds.has(ticket.id)) next.set(ticket.id, ticket);
      for (const [id, ticket] of prev) {
        if (selectedIds.has(id) && !next.has(id)) next.set(id, ticket);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content, not Set identity
  }, [selectedIdsKey, tickets]);

  const handleSelectAll = useCallback(() => {
    const next = new Map<string, Ticket>();
    for (const ticket of tickets.slice(0, MAX_BULK_TICKETS)) next.set(ticket.id, ticket);
    emitSelection(next);
    if (tickets.length > MAX_BULK_TICKETS || hasMore) {
      toast.info(
        `Selected the first ${next.size} loaded tickets — bulk actions apply to ${MAX_BULK_TICKETS} at a time.`,
      );
    }
  }, [tickets, hasMore, emitSelection]);

  const clearSelection = useCallback(() => emitSelection(new Map()), [emitSelection]);

  const handleBulkUpdate = useCallback(
    (updates: BulkTicketUpdates = {}) => {
      if (Object.keys(updates).length > 0) {
        applyUpdates(Array.from(selected.values()), updates);
      }
      clearSelection();
    },
    [selected, applyUpdates, clearSelection],
  );

  const handleBulkTagUpdate = useCallback(
    (tagsToAdd: string[]) => {
      applyTags(Array.from(selected.values()), tagsToAdd);
      clearSelection();
    },
    [selected, applyTags, clearSelection],
  );

  const openTicketImpl = useCallback(
    (ticket: Ticket) => {
      // Desk tickets open in the Support screen, not the chat ticket panel.
      const ticketChannel = allChannels.find(c => c.id === ticket.channelId);
      if (isDeskChannelType(ticketChannel?.type) && ticket.xyneId) {
        void navigate(`/support/${ticket.channelId}/${ticket.xyneId}`, {
          state: { conversationId: ticket.conversationId, ticketId: ticket.id },
        });
        return;
      }

      if (onTitleClick) {
        onTitleClick(ticket);
        return;
      }

      const currentUrl = window.location.pathname + window.location.search;
      const navState = { state: { fromMyTickets: false, returnToUrl: currentUrl } };

      // Desk/support tickets (EMAIL / SLACK / APP channels) open in the
      // Support desk email view (/support/:channelId/:xyneId), not chat.
      const ticketChannelType = channelsById.get(ticket.channelId)?.type;
      if (isDeskChannelType(ticketChannelType)) {
        // Deep-link when we have the xyneId; else fall back to the channel's
        // support inbox — a desk ticket must never open in chat.
        const supportRoute = ticket.xyneId
          ? `/support/${ticket.channelId}/${ticket.xyneId}`
          : `/support/${ticket.channelId}`;
        void navigate(supportRoute, navState);
        return;
      }

      // On mobile: navigate directly to ThreadMessages route with details tab
      // On desktop: use tab-based route for expanded view in ConversationPannel
      if (isMobile) {
        void navigate(
          `${baseRoute}/${ticket.channelId}/${ticket.conversationId}/${ticket.id}?selectedTab=details`,
          navState,
        );
      } else {
        void navigate(
          buildChannelRoute(ticket.channelId, {
            tab: 'tickets',
            ticketId: ticket.id,
            conversationId: ticket.conversationId,
          }),
          navState,
        );
      }
    },
    [allChannels, channelsById, onTitleClick, navigate, isMobile, baseRoute, buildChannelRoute],
  );
  const openTicketRef = useRef(openTicketImpl);
  useEffect(() => {
    openTicketRef.current = openTicketImpl;
  });
  const openTicket = useCallback((ticket: Ticket) => openTicketRef.current(ticket), []);
  const onOpen = onRowClick ?? openTicket;

  const listRef = useRef<HTMLDivElement | null>(null);
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  const usesExternalScroller = scrollElement !== undefined;
  const rowHeight = isComfortView ? ROW_HEIGHT_COMFORT : ROW_HEIGHT_COMPACT;

  const [scrollMargin, setScrollMargin] = useState(0);
  const measureScrollMargin = useCallback((): void => {
    const scroller = scrollElement;
    if (!scroller || !listRef.current) return;
    const offset =
      listRef.current.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setScrollMargin(prev => (Math.abs(prev - offset) < 1 ? prev : offset));
  }, [scrollElement]);
  useLayoutEffect(() => {
    if (usesExternalScroller) measureScrollMargin();
  });
  useLayoutEffect(() => {
    if (!usesExternalScroller || !scrollElement) return undefined;
    const observer = new ResizeObserver(measureScrollMargin);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [usesExternalScroller, scrollElement, measureScrollMargin]);

  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(tickets.length / pageSize));
  useEffect(() => {
    setPageIndex(prev => Math.min(prev, pageCount - 1));
  }, [pageCount]);
  const pageTickets = useMemo(
    () => (isPagesMode ? tickets.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize) : tickets),
    [isPagesMode, tickets, pageIndex, pageSize],
  );

  const showTrailingRow =
    !isPagesMode && tickets.length > 0 && (hasMore || isLoadingMore || totalCount !== undefined);
  const itemCount = isPagesMode ? 0 : tickets.length + (showTrailingRow ? 1 : 0);

  const getScrollElement = useCallback(
    () => (usesExternalScroller ? (scrollElement ?? null) : internalScrollRef.current),
    [usesExternalScroller, scrollElement],
  );

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement,
    estimateSize: index => (index >= tickets.length ? TRAILING_ROW_HEIGHT : rowHeight),
    // ~1.5 viewports of rows pre-mounted each direction, so fast scrolls land
    // on rendered rows instead of a blank gap (the ghost shimmer covers what
    // even this can't). Pickers and hover cards do their heavy work on open.
    overscan: 45,
    scrollMargin: usesExternalScroller ? scrollMargin : 0,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Keyboard navigation: j/k to move, Enter to open the highlighted row.
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const rowCount = tickets.length;
  useEffect(() => {
    setHighlightedIndex(prev =>
      prev !== null && prev >= rowCount ? Math.max(0, rowCount - 1) : prev,
    );
  }, [rowCount]);

  const moveBy = useCallback(
    (delta: number) => {
      setHighlightedIndex(prev => {
        const next =
          prev === null
            ? delta > 0
              ? 0
              : Math.max(0, rowCount - 1)
            : Math.max(0, Math.min(rowCount - 1, prev + delta));
        if (isPagesMode) {
          setPageIndex(Math.floor(next / pageSize));
        } else {
          virtualizer.scrollToIndex(next, { align: 'auto' });
        }
        return next;
      });
    },
    [rowCount, isPagesMode, pageSize, virtualizer],
  );

  useShortcut('j', () => moveBy(1), {
    scope: 'global',
    description: 'Next ticket in list',
    category: 'Tickets',
    enabled: rowCount > 0,
    when: () => !isInsideOverlay(),
  });
  useShortcut('k', () => moveBy(-1), {
    scope: 'global',
    description: 'Previous ticket in list',
    category: 'Tickets',
    enabled: rowCount > 0,
    when: () => !isInsideOverlay(),
  });
  useShortcut(
    'enter',
    () => {
      if (highlightedIndex === null) return;
      const row = tickets[highlightedIndex];
      if (row) onOpen(row);
    },
    {
      scope: 'global',
      description: 'Open selected ticket',
      category: 'Tickets',
      enabled: rowCount > 0 && highlightedIndex !== null,
      when: () => !isInsideOverlay() && !isActivatableFocused(),
    },
  );

  const lastRequestedAtRef = useRef(-1);

  useEffect(() => {
    lastRequestedAtRef.current = -1;
  }, [onLoadMore]);
  const lastRenderedIndex = virtualItems.length ? virtualItems[virtualItems.length - 1]!.index : -1;
  useEffect(() => {
    if (!hasMore || isLoadingMore || !onLoadMore) return;
    if (lastRenderedIndex < 0 || tickets.length === 0) return;
    if (lastRenderedIndex < tickets.length - LOAD_MORE_REMAINING_ROWS) return;
    if (lastRequestedAtRef.current === tickets.length) return;
    lastRequestedAtRef.current = tickets.length;
    onLoadMore();
  }, [lastRenderedIndex, tickets.length, hasMore, isLoadingMore, onLoadMore]);

  const [visibleTicketIds, setVisibleTicketIds] = useState<string[]>([]);
  useEffect(() => {
    const ids = isPagesMode
      ? pageTickets.map(t => t.id).sort()
      : virtualItems
          .filter(item => item.index < tickets.length)
          .map(item => tickets[item.index]!.id)
          .sort();
    setVisibleTicketIds(prev =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids,
    );
  }, [virtualItems, tickets, isPagesMode, pageTickets]);

  const [subTicketMappings] = useCachedQuery(
    queries.subTicketMappingsForTickets({ ticketIds: visibleTicketIds }),
    { enabled: visibleTicketIds.length > 0 },
  );
  const subProgressByTicketId = useMemo(() => {
    const map = new Map<string, SubTicketProgress>();
    subTicketMappings?.forEach(mapping => {
      const entry = map.get(mapping.ticketId) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (mapping.subTicket?.mappedTicket?.statusV2 === TicketStatusV2.COMPLETED) entry.done += 1;
      map.set(mapping.ticketId, entry);
    });
    return map;
  }, [subTicketMappings]);

  const visibleBoardIds = useMemo(() => {
    const ticketsById = new Map(tickets.map(t => [t.id, t]));
    return Array.from(
      new Set(
        visibleTicketIds.map(id => ticketsById.get(id)?.boardId).filter((id): id is string => !!id),
      ),
    ).sort();
  }, [visibleTicketIds, tickets]);
  const [visibleBoards] = useCachedQuery(queries.boardsByIds({ boardIds: visibleBoardIds }), {
    enabled: visibleBoardIds.length > 0,
  });
  const boardNameById = useMemo(
    () => new Map((visibleBoards ?? []).map(board => [board.id, board.name])),
    [visibleBoards],
  );

  // Fast flicks outrun React row rendering no matter the overscan; these ghost
  // regions cover the not-yet-mounted gaps with skeleton rows drawn in CSS,
  // which paints synchronously with the scroll. Real rows replace them as soon
  // as the virtualizer catches up.
  const ghostStyle = useMemo<React.CSSProperties>(() => {
    const barTop = (rowHeight - 12) / 2;
    return {
      backgroundImage:
        `linear-gradient(to bottom, transparent ${barTop}px, hsl(var(--muted)) ${barTop}px, hsl(var(--muted)) ${barTop + 12}px, transparent ${barTop + 12}px), ` +
        `linear-gradient(to bottom, transparent ${rowHeight - 1}px, hsl(var(--border)) ${rowHeight - 1}px)`,
      backgroundSize: `min(45%, 360px) ${rowHeight}px, 100% ${rowHeight}px`,
      backgroundPosition: '48px 0, 0 0',
      backgroundRepeat: 'repeat-y, repeat-y',
    };
  }, [rowHeight]);
  const ghostRegions: Array<{ top: number; height: number }> = [];
  if (virtualItems.length > 0) {
    const offset = usesExternalScroller ? scrollMargin : 0;
    const firstTop = virtualItems[0]!.start - offset;
    const lastEnd = virtualItems[virtualItems.length - 1]!.end - offset;
    const totalSize = virtualizer.getTotalSize();
    if (firstTop > 0) ghostRegions.push({ top: 0, height: firstTop });
    if (lastEnd < totalSize) ghostRegions.push({ top: lastEnd, height: totalSize - lastEnd });
  }

  const listBody = (
    <div
      ref={listRef}
      role='list'
      className='relative w-full'
      // getTotalSize() excludes scrollMargin; items translate by (start - margin).
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {ghostRegions.map(region => (
        <div
          key={`ghost-${region.top}`}
          aria-hidden
          className='pointer-events-none absolute left-0 w-full animate-pulse'
          style={{ top: `${region.top}px`, height: `${region.height}px`, ...ghostStyle }}
        />
      ))}
      {virtualItems.map(item => {
        const start = item.start - (usesExternalScroller ? scrollMargin : 0);
        if (item.index >= tickets.length) {
          return (
            <div
              key='trailing'
              className='absolute left-0 top-0 flex w-full items-center justify-center text-xs text-muted-foreground'
              style={{ height: `${item.size}px`, transform: `translateY(${start}px)` }}
            >
              {hasMore || isLoadingMore
                ? 'Loading more tickets…'
                : // A total below the loaded count means the counts service is
                  // still loading or failed — show no misleading number.
                  totalCount !== undefined && totalCount >= tickets.length
                  ? `End of results — ${totalCount} ticket${totalCount === 1 ? '' : 's'}`
                  : 'End of results'}
            </div>
          );
        }
        const ticket = tickets[item.index]!;
        return (
          <div
            key={ticket.id}
            role='listitem'
            className={`absolute left-0 top-0 w-full border-b border-border hover:bg-muted/60 ${
              highlightedIndex === item.index ? 'bg-muted' : ''
            }`}
            style={{ height: `${item.size}px`, transform: `translateY(${start}px)` }}
          >
            <TicketListRow
              ticket={ticket}
              isSelected={selected.has(ticket.id)}
              onToggleSelect={toggleSelect}
              tags={ticketTags?.get(ticket.id) || []}
              availableTags={availableTags}
              visibleColumns={visibleColumns}
              subProgress={subProgressByTicketId.get(ticket.id)}
              boardName={boardNameById.get(ticket.boardId)}
              isComfortView={isComfortView}
              onOpen={onOpen}
            />
          </div>
        );
      })}
    </div>
  );

  const pagerButton = (
    label: string,
    targetPage: number,
    disabled: boolean,
    trackName: string,
  ): React.ReactNode => (
    <button
      key={trackName}
      disabled={disabled}
      onClick={() => setPageIndex(targetPage)}
      className='rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-40'
      data-track-category='Tickets'
      data-track-name={trackName}
    >
      {label}
    </button>
  );

  const pagesBody = (
    <>
      <div role='list'>
        {pageTickets.map((ticket, index) => (
          <div
            key={ticket.id}
            role='listitem'
            className={`border-b border-border hover:bg-muted/60 ${
              highlightedIndex === pageIndex * pageSize + index ? 'bg-muted' : ''
            }`}
            style={{ height: `${rowHeight}px` }}
          >
            <TicketListRow
              ticket={ticket}
              isSelected={selected.has(ticket.id)}
              onToggleSelect={toggleSelect}
              tags={ticketTags?.get(ticket.id) || []}
              availableTags={availableTags}
              visibleColumns={visibleColumns}
              subProgress={subProgressByTicketId.get(ticket.id)}
              boardName={boardNameById.get(ticket.boardId)}
              isComfortView={isComfortView}
              onOpen={onOpen}
            />
          </div>
        ))}
      </div>
      <div className='flex items-center justify-end gap-4 px-3 py-2 text-xs text-muted-foreground'>
        <span>
          {tickets.length === 0
            ? '0 tickets'
            : `${pageIndex * pageSize + 1} to ${Math.min((pageIndex + 1) * pageSize, tickets.length)} of ${tickets.length}`}
        </span>
        <div className='flex items-center gap-1'>
          {pagerButton('⏮', 0, pageIndex === 0, 'TablePageFirst')}
          {pagerButton('◀', Math.max(0, pageIndex - 1), pageIndex === 0, 'TablePagePrev')}
          <span className='px-1'>
            Page {pageIndex + 1} of {pageCount}
          </span>
          {pagerButton(
            '▶',
            Math.min(pageCount - 1, pageIndex + 1),
            pageIndex >= pageCount - 1,
            'TablePageNext',
          )}
          {pagerButton('⏭', pageCount - 1, pageIndex >= pageCount - 1, 'TablePageLast')}
        </div>
      </div>
    </>
  );

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {isLoading && tickets.length === 0 ? (
        <div className='flex h-24 items-center justify-center text-sm text-muted-foreground'>
          Loading tickets…
        </div>
      ) : tickets.length === 0 ? (
        <div className='flex h-24 items-center justify-center text-sm text-muted-foreground'>
          No tickets match the current filters.
        </div>
      ) : isPagesMode ? (
        pagesBody
      ) : usesExternalScroller ? (
        listBody
      ) : (
        <div ref={internalScrollRef} className='min-h-0 flex-1 overflow-y-auto'>
          {listBody}
        </div>
      )}

      {selected.size > 0 && (
        <BulkActionToolbar
          selectedCount={selected.size}
          onSelectAll={handleSelectAll}
          users={bulkAssignableUsers}
          userGroups={userGroups}
          onAssigneeChange={val => handleBulkUpdate(assigneeOptionToTicketUpdate(val))}
          onStatusChange={val => handleBulkUpdate({ statusV2: val })}
          onPriorityChange={val => handleBulkUpdate(val === null ? {} : { priority: val })}
          onStageChange={val => handleBulkUpdate({ stage: { name: val } })}
          onDueDateChange={date => {
            // `ticket.update` has no way to null an eta, so only a picked
            // date is applied — clearing in bulk isn't supported yet.
            if (date) handleBulkUpdate({ eta: dueDateToEta(date) });
          }}
          onClearSelection={clearSelection}
          availableTags={availableTags}
          onTagsChange={handleBulkTagUpdate}
        />
      )}
    </div>
  );
};
