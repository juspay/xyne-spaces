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
import { TicketPriority, MailboxState } from '@xyne/shared';
import type { MailboxFolder } from '../../xyne-desk/DeskFolders/DeskMailboxSidebar';
import {
  ticketMatchesDynamicFieldEntries,
  type DynamicFieldFilterEntry,
  type DynamicFieldQueryFilter,
  type FormEntityValueLike,
} from '../../../utils/board/dynamicFieldFilters';

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
    conversationIdWhitelist?: string[] | undefined;
    hasAiDraft?: boolean | undefined;
    userGroups?: string[] | undefined;
    lastEmailAtStart?: number | undefined;
    lastEmailAtEnd?: number | undefined;
    dynamicFieldFilters?: DynamicFieldQueryFilter[] | undefined;
    conversationLabelId?: string | undefined;
  };
  dynamicFieldEntries?: DynamicFieldFilterEntry[] | undefined;
  onTicketClick: (ticket: SupportTicketRow) => void;
  isMember: boolean;
  /**
   * When set, the current page is filtered into a per-user mailbox folder (Inbox / All Mail /
   * Starred / Spam) using each ticket's `userMailbox` overlay. Filtering is client-side
   * (a ticket with no overlay row defaults to Inbox, which can't be expressed server-side).
   */
  mailboxFolder?: MailboxFolder | undefined;
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
  mailboxFolder,
  dynamicFieldEntries,
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

  const {
    channelId,
    assignedTo,
    priority,
    stageName,
    aiCategory,
    conversationIdWhitelist,
    hasAiDraft,
    userGroups,
    lastEmailAtStart,
    lastEmailAtEnd,
    dynamicFieldFilters,
    conversationLabelId,
  } = filter;

  const [pageCursors, setPageCursors] = useState<Array<PageCursor | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectAllMenuOpen, setSelectAllMenuOpen] = useState(false);
  // Adaptive server fetch window. Starts at one page (+1 sentinel); grows only for the
  // client-filtered folders when a page needs more rows to fill after filtering.
  const [fetchLimit, setFetchLimit] = useState(PAGE_SIZE + 1);

  const pageStart = pageCursors[pageIndex] ?? null;
  const [firstPage, firstPageDetails] = useCachedQuery(
    queries.supportTicketsPageV3({
      channelId,
      isMember,
      assignedTo,
      priority,
      stageName,
      aiCategory,
      ...(conversationIdWhitelist !== undefined
        ? { conversationIds: conversationIdWhitelist }
        : {}),
      hasAiDraft,
      lastEmailAtStart,
      lastEmailAtEnd,
      // Spam/Starred are filtered server-side (they need an overlay row) so pagination is
      // meaningful; Inbox/All Mail are filtered client-side in `filteredAll` below, over an
      // adaptive fetch window so their pages fill correctly after filtering.
      ...(mailboxFolder ? { mailboxFolder } : {}),
      dynamicFieldFilters,
      limit: fetchLimit,
      userGroups,
      ...(conversationLabelId ? { conversationLabelId } : {}),
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
        ci: conversationIdWhitelist ?? null,
        ad: hasAiDraft ?? null,
        mf: mailboxFolder ?? null,
        g: userGroups ?? null,
        ds: lastEmailAtStart ?? null,
        de: lastEmailAtEnd ?? null,
        df: dynamicFieldEntries ?? null,
        l: conversationLabelId ?? null,
      }),
    [
      channelId,
      assignedTo,
      priority,
      stageName,
      aiCategory,
      conversationIdWhitelist,
      hasAiDraft,
      mailboxFolder,
      userGroups,
      lastEmailAtStart,
      lastEmailAtEnd,
      dynamicFieldEntries,
      conversationLabelId,
    ],
  );

  useEffect(() => {
    setPageCursors([null]);
    setPageIndex(0);
    loadStartTimeRef.current = Date.now();
  }, [filterKey]);

  // Each page (and each filter) begins a fresh adaptive fetch from its own cursor.
  useEffect(() => {
    setFetchLimit(PAGE_SIZE + 1);
  }, [pageStart, filterKey]);

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

  // Filter the WHOLE fetched buffer into the active mailbox folder BEFORE paginating, so
  // Inbox / All Mail paginate over the filtered result set (not a pre-sliced page). Inbox /
  // All Mail must be filtered client-side: they include tickets with no overlay row
  // (default = Inbox), which would need a NOT EXISTS predicate to filter server-side —
  // unsupported on the Zero client (bug 3438). Spam / Starred are already filtered
  // server-side, so this is a no-op for them.
  const filteredAll = useMemo<SupportTicketRow[]>(() => {
    let rows = allRows;
    if (mailboxFolder) {
      rows = rows.filter(t => {
        const overlay = (t.userMailbox ?? [])[0];
        const state = overlay?.state ?? MailboxState.INBOX;
        switch (mailboxFolder) {
          case 'all':
            return state === MailboxState.INBOX || state === MailboxState.ARCHIVED;
          case 'starred':
            return (
              !!overlay?.starred &&
              (state === MailboxState.INBOX || state === MailboxState.ARCHIVED)
            );
          case 'spam':
            return state === MailboxState.SPAM;
          case 'sent':
          case 'drafts':
            // Filtered server-side by a positive exists() (sent email / reply draft by me);
            // the exists() also runs on the client, so every fetched row already qualifies —
            // no overlay check here.
            return true;
          case 'inbox':
          default:
            return state === MailboxState.INBOX;
        }
      });
    }
    if (dynamicFieldEntries?.length) {
      rows = rows.filter(t =>
        ticketMatchesDynamicFieldEntries(
          t.formEntityValues as FormEntityValueLike[] | undefined,
          dynamicFieldEntries,
        ),
      );
    }
    return rows;
  }, [allRows, mailboxFolder, dynamicFieldEntries]);

  // Paginate over the FILTERED rows: render one PAGE_SIZE window; a (PAGE_SIZE+1)th filtered
  // row is the "next page exists" sentinel (mirrors the server keyset paging, on filtered rows).
  const filteredTickets = useMemo(() => filteredAll.slice(0, PAGE_SIZE), [filteredAll]);
  const hasNextPage = filteredAll.length > PAGE_SIZE;

  useEffect(() => {
    onTicketsLoaded?.(filteredTickets);
  }, [filteredTickets, onTicketsLoaded]);

  const complete = firstPageDetails.type === 'complete';
  // Server returned fewer rows than requested → the channel/folder is genuinely exhausted;
  // no amount of extra fetching can surface additional rows.
  const serverExhausted = allRows.length < fetchLimit;
  // A client-filtered folder (Inbox / All Mail) can filter a full server page down below a
  // page's worth. Keep growing the fetch window (effect below) until we have a full page
  // (+1 sentinel) of MATCHING rows OR the source is genuinely exhausted — there is no fixed
  // cap, so matching tickets sitting behind a long run of archived/spam are never missed.
  // `converged` = the page is definitive (safe to show its empty state).
  const needMoreRows = complete && !serverExhausted && filteredAll.length < PAGE_SIZE + 1;
  const converged = complete && !needMoreRows;

  const rowsEmpty = converged && filteredTickets.length === 0;
  const showInitialSkeletons = (!complete && allRows.length === 0) || needMoreRows;

  const isLastPage = !hasNextPage;

  const goToNextPage = useCallback(() => {
    if (isLastPage) return;
    // Continue from the last RENDERED (filtered) row: filtered rows are a subsequence of the
    // keyset-ordered buffer, so their (lastEmailAt, id) is a valid cursor and the next page
    // picks up the next matching rows without skipping or duplicating.
    const last = filteredTickets[filteredTickets.length - 1];
    if (!last) return;
    const cursor: PageCursor = { id: last.id, lastEmailAt: last.lastEmailAt };
    setPageCursors(prev => {
      const nextCursors = prev.slice(0, pageIndex + 1);
      nextCursors[pageIndex + 1] = cursor;
      return nextCursors;
    });
    setPageIndex(pageIndex + 1);
    onPageChange?.(pageIndex + 1);
  }, [isLastPage, filteredTickets, pageIndex, onPageChange]);

  const goToPrevPage = useCallback(() => {
    if (pageIndex === 0) return;
    setPageIndex(pageIndex - 1);
    onPageChange?.(pageIndex - 1);
  }, [pageIndex, onPageChange]);

  useEffect(() => {
    virtuosoRef.current?.scrollToIndex({ index: 0 });
  }, [pageIndex]);

  // Grow the fetch window until the client-filtered page holds a full PAGE_SIZE (+1 sentinel)
  // of matching rows, or the source is genuinely exhausted — so Inbox / All Mail never miss
  // matching tickets that sit behind a long run of archived/spam rows. Doubling keeps this to
  // O(log n) fetches even when a folder is sparse in a large channel; termination is
  // guaranteed because `serverExhausted` flips true once the window exceeds the row count.
  useEffect(() => {
    if (!needMoreRows) return;
    setFetchLimit(prev => prev * 2);
    // fetchLimit is a dep so the effect re-evaluates after each grow, even if a cached
    // refetch never lets `needMoreRows` flip to false in between.
  }, [needMoreRows, fetchLimit]);

  // If a page past the first ends up empty (e.g. its rows were archived/deleted after we
  // navigated to it), fall back toward populated pages.
  useEffect(() => {
    if (converged && filteredTickets.length === 0 && pageIndex > 0) {
      goToPrevPage();
    }
  }, [converged, filteredTickets.length, pageIndex, goToPrevPage]);

  const firstRowBoardId = (filteredTickets[0] ?? allRows[0])?.boardId;
  useEffect(() => {
    if (firstRowBoardId) onBoardIdReady?.(firstRowBoardId);
  }, [firstRowBoardId, onBoardIdReady]);

  // Keyboard navigation: j/k to move, Enter to open the highlighted row.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const rowCount = filteredTickets.length;

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
      const row = filteredTickets[selectedIndex];
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
      data={filteredTickets}
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
                  onToggleSelect: (): void => {
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
  const toIndex = pageIndex * PAGE_SIZE + filteredTickets.length;
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
  const pageRows: SelectableRow[] = filteredTickets.map(toSelectable);
  const unreadRows = filteredTickets.filter(isUnread).map(toSelectable);
  const readRows = filteredTickets.filter(t => !isUnread(t)).map(toSelectable);
  const selectedOnPage = pageRows.reduce((n, r) => (selectedIds?.has(r.id) ? n + 1 : n), 0);
  const totalSelected = selectedIds?.size ?? 0;
  const allSelected = pageRows.length > 0 && selectedOnPage === pageRows.length;
  const someSelected = selectedOnPage > 0 && !allSelected;
  const selectAllOptions: Array<{ label: string; run: () => void }> = [
    { label: 'All', run: () => onToggleSelectAll?.(pageRows, true) },
    { label: 'None', run: () => onToggleSelectAll?.(pageRows, false) },
    {
      label: 'Read',
      run: (): void => {
        onToggleSelectAll?.(pageRows, false);
        onToggleSelectAll?.(readRows, true);
      },
    },
    {
      label: 'Unread',
      run: (): void => {
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
        <div className='flex flex-col items-end gap-1'>
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
          <div className='flex items-center gap-3' aria-hidden='true'>
            <span className='w-[100px]' />
            <span className='w-5' />
            <span className='w-[118px] text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
              Created at
            </span>
            <span className='w-[120px] text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
              Latest email
            </span>
          </div>
        </div>
      </div>
      <div className='flex-1 min-h-0'>{list}</div>
    </div>
  );
};
