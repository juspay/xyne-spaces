import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { Skeleton } from '../../ui/Skeleton';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { Popover } from '../../ui/Popover/Popover';
import { TicketListRow } from './TicketListRow';
import { queries } from '../../../zero/queries';
import { useShortcut } from '../../../shortcuts';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { dataLoadDuration, safeRecordMetric } from '../../../services/otel';
import { logger, Event } from '../../../utils/logger';
import type { QueryResultType } from '@rocicorp/zero';
import type { TicketListItem } from './TicketListView.types';
import { TicketPriority } from '@xyne/shared';

const PAGE_SIZE = 50;

export type SupportTicketRow = NonNullable<
  QueryResultType<typeof queries.supportTicketsPageV3>[number]
>;

type PageCursor = { id: string; lastEmailAt: number };

interface TicketListViewProps {
  filter: {
    channelId: string;
    assignedTo?: string[] | undefined;
    priority?: TicketPriority[] | undefined;
    stageName?: string[] | undefined;
    aiCategory?: string[] | undefined;
    hasAiDraft?: boolean | undefined;
  };
  onTicketClick: (ticket: SupportTicketRow) => void;
  isMember: boolean;
  activeTicketId?: string | null | undefined;
  showExtraFields?: boolean;
  skeletonRowCount?: number;
  emptyState?: React.ReactNode;
  className?: string;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (row: SelectableRow) => void;
  onBoardIdReady?: (boardId: string) => void;
  onPageChange?: (pageIndex: number) => void;
  onToggleSelectAll?: (rows: SelectableRow[], select: boolean) => void;
  onTicketsLoaded?: (tickets: SupportTicketRow[]) => void;
}

export interface SelectableRow {
  id: string;
  lastEmailAt: number;
  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }>;
  title: string;
  xyneId: string;
  createdAt: number;
  channelId: string;
  conversationId: string;
}

export const TicketListView = function TicketListView({
  filter,
  isMember,
  onTicketClick,
  activeTicketId,
  showExtraFields = false,
  skeletonRowCount = 8,
  emptyState,
  className,
  selectedIds,
  onToggleSelect,
  onBoardIdReady,
  onPageChange,
  onToggleSelectAll,
  onTicketsLoaded,
}: TicketListViewProps): React.ReactElement {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { userID } = useAuthContextValues();

  const { channelId, assignedTo, priority, stageName, aiCategory, hasAiDraft } = filter;

  const [pageCursors, setPageCursors] = useState<Array<PageCursor | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectAllMenuOpen, setSelectAllMenuOpen] = useState(false);

  const pageStart = pageCursors[pageIndex] ?? null;
  const [firstPage, firstPageDetails] = useCachedQuery(
    queries.supportTicketsPageV3({
      channelId,
      isMember,
      assignedTo,
      priority,
      stageName,
      aiCategory,
      hasAiDraft,
      limit: PAGE_SIZE + 1,
      start: pageStart,
      dir: 'forward',
    }),
  );

  const loadStartTimeRef = useRef<number | null>(Date.now());

  // Filter key — reset accumulator + pagination when filter changes (new view = new data).
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        c: channelId,
        a: assignedTo ?? null,
        p: priority ?? null,
        s: stageName ?? null,
        ac: aiCategory ?? null,
        ad: hasAiDraft ?? null,
      }),
    [channelId, assignedTo, priority, stageName, aiCategory, hasAiDraft],
  );

  useEffect(() => {
    setPageCursors([null]);
    setPageIndex(0);
    loadStartTimeRef.current = Date.now();
  }, [filterKey]);

  // Record first-page load duration once it becomes complete.
  useEffect(() => {
    if (firstPageDetails.type !== 'complete') return;
    if (loadStartTimeRef.current === null) return;
    const duration = Date.now() - loadStartTimeRef.current;
    logger.info(Event.SUPPORT_TICKETS_LOADED, {
      source: 'TicketListView',
      message: 'Support tickets first page loaded',
      durationMs: duration,
      channelId,
      url: window.location.href,
    });
    safeRecordMetric(() => {
      dataLoadDuration.record(duration, {
        source: 'TicketListView',
        event: Event.SUPPORT_TICKETS_LOADED,
        platform: logger.platformName,
      });
    });
    loadStartTimeRef.current = null;
  }, [firstPageDetails.type, filterKey, channelId]);

  // Fetch PAGE_SIZE + 1: render the first PAGE_SIZE; the extra row signals there's a next page.
  const allRows = useMemo<SupportTicketRow[]>(() => {
    const page = (firstPage as SupportTicketRow[] | undefined) ?? [];
    const seen = new Set<string>();
    const unique: SupportTicketRow[] = [];
    for (const t of page) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        unique.push(t);
      }
    }
    unique.sort((a, b) => {
      if (b.lastEmailAt !== a.lastEmailAt) return b.lastEmailAt - a.lastEmailAt;
      return b.id.localeCompare(a.id);
    });
    return unique;
  }, [firstPage]);

  const hasNextPage = allRows.length > PAGE_SIZE;
  const tickets = useMemo(() => allRows.slice(0, PAGE_SIZE), [allRows]);

  useEffect(() => {
    onTicketsLoaded?.(tickets);
  }, [tickets, onTicketsLoaded]);

  const complete = firstPageDetails.type === 'complete';
  const rowsEmpty = complete && tickets.length === 0;
  const showInitialSkeletons = !complete && tickets.length === 0;

  const isLastPage = !hasNextPage;

  const goToNextPage = useCallback(() => {
    if (isLastPage) return;
    const last = tickets[tickets.length - 1];
    if (!last) return;
    const cursor: PageCursor = { id: last.id, lastEmailAt: last.lastEmailAt };
    setPageCursors(prev => {
      const nextCursors = prev.slice(0, pageIndex + 1);
      nextCursors[pageIndex + 1] = cursor;
      return nextCursors;
    });
    setPageIndex(pageIndex + 1);
    onPageChange?.(pageIndex + 1);
  }, [isLastPage, tickets, pageIndex, onPageChange]);

  const goToPrevPage = useCallback(() => {
    if (pageIndex === 0) return;
    setPageIndex(pageIndex - 1);
    onPageChange?.(pageIndex - 1);
  }, [pageIndex, onPageChange]);

  useEffect(() => {
    virtuosoRef.current?.scrollToIndex({ index: 0 });
  }, [pageIndex]);

  // Snap back if we land on an empty page past page 0 (stale count / live deletes).
  useEffect(() => {
    if (rowsEmpty && pageIndex > 0) {
      const target = pageIndex - 1;
      setPageIndex(target);
      onPageChange?.(target);
    }
  }, [rowsEmpty, pageIndex, onPageChange]);

  const firstRowBoardId = tickets[0]?.boardId;
  useEffect(() => {
    if (firstRowBoardId) onBoardIdReady?.(firstRowBoardId);
  }, [firstRowBoardId, onBoardIdReady]);

  // Keyboard navigation: j/k to move, Enter to open the highlighted row.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const rowCount = tickets.length;

  const moveBy = useCallback(
    (delta: number) => {
      setSelectedIndex(prev => {
        const next =
          prev === null
            ? delta > 0
              ? 0
              : Math.max(0, rowCount - 1)
            : Math.max(0, Math.min(rowCount - 1, prev + delta));
        virtuosoRef.current?.scrollToIndex({ index: next, align: 'center' });
        return next;
      });
    },
    [rowCount],
  );

  useShortcut('j', () => moveBy(1), {
    scope: 'global',
    description: 'Next ticket in list',
    category: 'Support',
    enabled: !rowsEmpty,
  });
  useShortcut('k', () => moveBy(-1), {
    scope: 'global',
    description: 'Previous ticket in list',
    category: 'Support',
    enabled: !rowsEmpty,
  });
  useShortcut(
    'enter',
    () => {
      if (selectedIndex === null) return;
      const row = tickets[selectedIndex];
      if (row) onTicketClick(row);
    },
    {
      scope: 'global',
      description: 'Open selected ticket',
      category: 'Support',
      enabled: !rowsEmpty && selectedIndex !== null,
    },
  );

  if (rowsEmpty) {
    return (
      <div
        data-slot='ticket-list-view'
        role='list'
        aria-label='Tickets'
        className={cn('h-full w-full flex items-center justify-center', className)}
      >
        <div className='py-12 text-muted-foreground text-sm'>
          {emptyState ?? 'No tickets found'}
        </div>
      </div>
    );
  }

  if (showInitialSkeletons) {
    return (
      <div
        data-slot='ticket-list-view'
        role='list'
        aria-label='Tickets'
        className={cn('h-full w-full overflow-y-auto outline-none', className)}
      >
        <div className='flex flex-col'>
          {Array.from({ length: skeletonRowCount }).map((_, i) => (
            <div key={i} className='flex items-center gap-3 px-6 py-3 border-b border-border'>
              <Skeleton className='h-3.5 w-3.5 rounded-full flex-shrink-0' />
              <Skeleton className='h-3 w-24 flex-shrink-0' />
              <Skeleton className='h-3.5 w-full max-w-[300px]' />
              <div className='flex-1' />
              <Skeleton className='h-3 w-12 flex-shrink-0' />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const list = (
    <Virtuoso
      ref={virtuosoRef}
      data={tickets}
      data-slot='ticket-list-view'
      tabIndex={0}
      onFocus={(e: React.FocusEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (selectedIndex === null && !rowsEmpty) {
          setSelectedIndex(0);
        }
      }}
      className={cn('h-full w-full outline-none')}
      initialTopMostItemIndex={0}
      increaseViewportBy={{ top: 0, bottom: 200 }}
      itemContent={(index, row) => {
        const ticketIdValue = row?.xyneId || row?.id || '';
        const isActive =
          !!row &&
          (activeTicketId
            ? activeTicketId === ticketIdValue
            : selectedIndex !== null && index === selectedIndex);
        return (
          <TicketListRow
            ticket={row as TicketListItem}
            isActive={isActive}
            showExtraFields={showExtraFields}
            {...(onToggleSelect
              ? {
                  isSelected: selectedIds?.has(row.id) ?? false,
                  onToggleSelect: () => {
                    const emailReads = row.emailReads as
                      | ReadonlyArray<{ userId: string; lastReadEmailAt: number }>
                      | undefined;
                    onToggleSelect({
                      id: row.id,
                      lastEmailAt: row.lastEmailAt,
                      title: row.title ?? '',
                      xyneId: row.xyneId ?? '',
                      createdAt: row.createdAt ?? 0,
                      channelId: row.channelId ?? '',
                      conversationId: row.conversationId ?? '',
                      ...(emailReads ? { emailReads } : {}),
                    });
                  },
                }
              : {})}
            onClick={() => onTicketClick(row)}
          />
        );
      }}
      components={{}}
    />
  );

  const fromIndex = pageIndex * PAGE_SIZE + 1;
  const toIndex = pageIndex * PAGE_SIZE + tickets.length;
  const rangeLabel = `${fromIndex}–${toIndex}`;

  const toSelectable = (t: SupportTicketRow): SelectableRow => {
    const entry: SelectableRow = {
      id: t.id,
      lastEmailAt: t.lastEmailAt,
      title: t.title ?? '',
      xyneId: t.xyneId ?? '',
      createdAt: t.createdAt ?? 0,
      channelId: t.channelId ?? '',
      conversationId: t.conversationId ?? '',
    };
    const emailReads = t.emailReads as
      | ReadonlyArray<{ userId: string; lastReadEmailAt: number }>
      | undefined;
    if (emailReads !== undefined) entry.emailReads = emailReads;
    return entry;
  };
  // Mirrors TicketListRow's hasUnread; drives the Read/Unread quick-selects.
  const isUnread = (t: SupportTicketRow): boolean => {
    const reads = t.emailReads as
      | ReadonlyArray<{ userId: string; lastReadEmailAt: number }>
      | undefined;
    const userRow = (reads ?? []).find(r => r.userId === userID);
    return (t.emailCount ?? 0) > 0 && (!userRow || userRow.lastReadEmailAt < (t.lastEmailAt ?? 0));
  };
  const pageRows: SelectableRow[] = tickets.map(toSelectable);
  const unreadRows = tickets.filter(isUnread).map(toSelectable);
  const readRows = tickets.filter(t => !isUnread(t)).map(toSelectable);
  const selectedOnPage = pageRows.reduce((n, r) => (selectedIds?.has(r.id) ? n + 1 : n), 0);
  const totalSelected = selectedIds?.size ?? 0;
  const allSelected = pageRows.length > 0 && selectedOnPage === pageRows.length;
  const someSelected = selectedOnPage > 0 && !allSelected;
  const selectAllOptions: Array<{ label: string; run: () => void }> = [
    { label: 'All', run: () => onToggleSelectAll?.(pageRows, true) },
    { label: 'None', run: () => onToggleSelectAll?.(pageRows, false) },
    {
      label: 'Read',
      run: () => {
        onToggleSelectAll?.(pageRows, false);
        onToggleSelectAll?.(readRows, true);
      },
    },
    {
      label: 'Unread',
      run: () => {
        onToggleSelectAll?.(pageRows, false);
        onToggleSelectAll?.(unreadRows, true);
      },
    },
  ];

  return (
    <div className={cn('flex flex-col h-full w-full', className)}>
      <div
        data-slot='ticket-list-toolbar'
        className='flex items-center justify-between gap-2 px-6 py-2 border-b border-border'
      >
        {onToggleSelectAll ? (
          <div className='flex items-center gap-1'>
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              accent
              // none selected → select all; partial or all selected → clear.
              onChange={() => onToggleSelectAll(pageRows, selectedOnPage === 0)}
              label=''
            />
            <Popover
              open={selectAllMenuOpen}
              onOpenChange={setSelectAllMenuOpen}
              align='start'
              sideOffset={4}
              className='p-1 w-32'
              trigger={
                <button
                  type='button'
                  aria-label='Selection options'
                  data-track-category='Support'
                  data-track-name='SelectAllMenu'
                  className='p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted'
                >
                  <ChevronDown size={14} />
                </button>
              }
            >
              <div className='flex flex-col'>
                {selectAllOptions.map(opt => (
                  <button
                    key={opt.label}
                    type='button'
                    onClick={() => {
                      opt.run();
                      setSelectAllMenuOpen(false);
                    }}
                    className='text-left px-3 py-1.5 text-xs text-foreground rounded hover:bg-muted'
                    data-track-category='Support'
                    data-track-name={`SelectAll${opt.label}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </Popover>
            <span className='text-xs text-muted-foreground ml-1'>
              {totalSelected > 0 ? `${totalSelected} selected` : 'Select'}
            </span>
          </div>
        ) : (
          <span />
        )}
        <div data-slot='ticket-list-pagination' className='flex items-center gap-2'>
          <span className='text-sm text-muted-foreground px-1'>{rangeLabel}</span>
          <button
            type='button'
            onClick={goToPrevPage}
            disabled={pageIndex === 0}
            aria-label='Previous page'
            data-track-category='Support'
            data-track-name='PaginationPrev'
            className='p-1.5 rounded-full border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type='button'
            onClick={goToNextPage}
            disabled={isLastPage}
            aria-label='Next page'
            data-track-category='Support'
            data-track-name='PaginationNext'
            className='p-1.5 rounded-full border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className='flex-1 min-h-0'>{list}</div>
    </div>
  );
};
