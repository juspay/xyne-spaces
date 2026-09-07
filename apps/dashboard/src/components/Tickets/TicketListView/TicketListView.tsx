import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ChevronLeft, ChevronRight, ChevronDown } from '@xyne/icons';
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
import {
  DEFAULT_TICKET_LIST_COLUMN_WIDTHS,
  getTicketListColumnAlignClass,
  getTicketListGridTemplate,
  TICKET_LIST_COLUMN_GAP,
  TICKET_LIST_COLUMN_PADDING_X,
  TICKET_LIST_COLUMNS,
  TICKET_LIST_HORIZONTAL_PADDING,
  TICKET_LIST_SELECTION_COLUMN_WIDTH,
  type TicketListColumnKey,
  type TicketListColumnWidths,
} from './ticketListColumns';

const PAGE_SIZE = 50;
const COLUMN_WIDTHS_STORAGE_KEY = 'xyne:desk-ticket-list-column-widths:v2';

interface ColumnResizeDrag {
  column: TicketListColumnKey;
  adjacentColumn: TicketListColumnKey;
  pointerId: number;
  startX: number;
  startWidth: number;
  startAdjacentWidth: number;
  availableWidth: number;
  totalWidthUnits: number;
  handle: HTMLButtonElement;
  previousCursor: string;
  previousUserSelect: string;
}

// Pixel width the `fr` columns span: container minus row padding, gaps and selection column.
const computeAvailableColumnsWidth = (
  containerWidth: number,
  showSelectionColumn: boolean,
): number => {
  const columnCount = TICKET_LIST_COLUMNS.length + (showSelectionColumn ? 1 : 0);
  return Math.max(
    1,
    containerWidth -
      TICKET_LIST_HORIZONTAL_PADDING -
      TICKET_LIST_COLUMN_GAP * Math.max(0, columnCount - 1) -
      (showSelectionColumn ? TICKET_LIST_SELECTION_COLUMN_WIDTH : 0),
  );
};

const loadColumnWidths = (): TicketListColumnWidths => {
  const widths = { ...DEFAULT_TICKET_LIST_COLUMN_WIDTHS };
  if (typeof window === 'undefined') return widths;

  try {
    const stored = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
    if (!stored) return widths;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    for (const column of TICKET_LIST_COLUMNS) {
      const storedWidth = parsed[column.key];
      if (typeof storedWidth === 'number' && Number.isFinite(storedWidth) && storedWidth > 0) {
        widths[column.key] = storedWidth;
      }
    }
  } catch {
    // Ignore unavailable storage or malformed preferences and use defaults.
  }
  return widths;
};

export type SupportTicketRow = NonNullable<
  QueryResultType<typeof queries.supportTicketsPageV3>[number]
>;

type PageCursor = { id: string; lastEmailAt: number };

interface TicketListViewProps {
  filter: {
    channelId: string;
    assignedTo?: string[] | undefined;
    createdBy?: string[] | undefined;
    priority?: TicketPriority[] | undefined;
    stageName?: string[] | undefined;
    aiCategory?: string[] | undefined;
    conversationIdWhitelist?: string[] | undefined;
    hasAiDraft?: boolean | undefined;
    hasSubTickets?: boolean | undefined;
    userGroups?: string[] | undefined;
    lastEmailAtStart?: number | undefined;
    lastEmailAtEnd?: number | undefined;
    createdAtStart?: number | undefined;
    createdAtEnd?: number | undefined;
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
  stageName?: string | null;
  priority?: TicketListItem['priority'];
  assignedTo?: string | null;
  userGroupId?: string | null;
  // Carried for the bulk bar — see SelectedTicket in SupportScreen.
  boardId?: string | null;
  projectId?: string | null;
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
    createdBy,
    priority,
    stageName,
    aiCategory,
    conversationIdWhitelist,
    hasAiDraft,
    hasSubTickets,
    userGroups,
    lastEmailAtStart,
    lastEmailAtEnd,
    createdAtStart,
    createdAtEnd,
    dynamicFieldFilters,
    conversationLabelId,
  } = filter;

  const [pageCursors, setPageCursors] = useState<Array<PageCursor | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectAllMenuOpen, setSelectAllMenuOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState<TicketListColumnWidths>(loadColumnWidths);
  const [resizingColumn, setResizingColumn] = useState<TicketListColumnKey | null>(null);
  const resizeDragRef = useRef<ColumnResizeDrag | null>(null);
  const columnHeadersRef = useRef<HTMLDivElement>(null);
  // Virtuoso's scroller: rows render inside it (net of its scrollbar) while the header and
  // resize overlay sit outside, so both pad by `scrollbarGutter` to stay column-aligned.
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const scrollbarObserverRef = useRef<ResizeObserver | null>(null);
  const [scrollbarGutter, setScrollbarGutter] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  // Kept raw so the derived width recomputes against the current showSelectionColumn.
  const [scrollerClientWidth, setScrollerClientWidth] = useState(0);
  // Real row content height — shorter than the viewport when there are only a few rows.
  const [bodyContentHeight, setBodyContentHeight] = useState(0);
  // Callback ref, not an effect: re-runs across the skeleton/empty/loaded branch swaps below.
  const tableWrapperRef = useCallback((node: HTMLDivElement | null): void => {
    scrollbarObserverRef.current?.disconnect();
    scrollbarObserverRef.current = null;
    scrollerElRef.current = null;
    if (!node) return;
    const scroller = node.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]');
    if (!scroller) return;
    scrollerElRef.current = scroller;
    const header = columnHeadersRef.current;
    const measure = (): void => {
      setScrollbarGutter(Math.max(0, scroller.offsetWidth - scroller.clientWidth));
      setListViewportHeight(scroller.clientHeight);
      setScrollerClientWidth(scroller.clientWidth);
      setHeaderHeight(header?.offsetHeight ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (header) observer.observe(header);
    scrollbarObserverRef.current = observer;
  }, []);
  // Adaptive server fetch window. Starts at one page (+1 sentinel); grows only for the
  // client-filtered folders when a page needs more rows to fill after filtering.
  const [fetchLimit, setFetchLimit] = useState(PAGE_SIZE + 1);
  const showSelectionColumn = !!onToggleSelect;
  const ticketListGridTemplate = useMemo(
    () => getTicketListGridTemplate(columnWidths, showSelectionColumn),
    [columnWidths, showSelectionColumn],
  );

  // Persist on drag settle only — `columnWidths` changes every pointermove and setItem is sync.
  useEffect(() => {
    if (resizingColumn) return;
    try {
      localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {
      // Column resizing remains available when storage is blocked.
    }
  }, [columnWidths, resizingColumn]);

  useEffect((): (() => void) => {
    return (): void => {
      const drag = resizeDragRef.current;
      if (!drag) return;
      document.body.style.cursor = drag.previousCursor;
      document.body.style.userSelect = drag.previousUserSelect;
    };
  }, []);

  const getAvailableColumnsWidth = useCallback((): number => {
    // Header ref is only a fallback for the first render, before the callback ref runs.
    const containerWidth =
      scrollerElRef.current?.clientWidth ?? columnHeadersRef.current?.clientWidth ?? 1;
    return computeAvailableColumnsWidth(containerWidth, showSelectionColumn);
  }, [showSelectionColumn]);

  // Denominator for unit → pixel conversion. A drag only shifts width between two adjacent
  // columns, so the total stays constant.
  const totalColumnUnits = useMemo(
    () => TICKET_LIST_COLUMNS.reduce((total, item) => total + columnWidths[item.key], 0),
    [columnWidths],
  );
  const columnsPixelWidth = computeAvailableColumnsWidth(scrollerClientWidth, showSelectionColumn);
  const columnPixelWidth = useCallback(
    (key: TicketListColumnKey): number =>
      totalColumnUnits > 0
        ? Math.round((columnWidths[key] / totalColumnUnits) * columnsPixelWidth)
        : 0,
    [columnWidths, totalColumnUnits, columnsPixelWidth],
  );

  const resizeColumnPair = useCallback(
    (
      column: TicketListColumnKey,
      adjacentColumn: TicketListColumnKey,
      startWidth: number,
      startAdjacentWidth: number,
      deltaPixels: number,
      availableWidth: number,
      totalWidthUnits: number,
    ): void => {
      const columnDefinition = TICKET_LIST_COLUMNS.find(item => item.key === column);
      const adjacentDefinition = TICKET_LIST_COLUMNS.find(item => item.key === adjacentColumn);
      if (!columnDefinition || !adjacentDefinition) return;

      const pixelsToUnits = totalWidthUnits / availableWidth;
      const pairWidth = startWidth + startAdjacentWidth;
      let minimumWidth = columnDefinition.minWidth * pixelsToUnits;
      let minimumAdjacentWidth = adjacentDefinition.minWidth * pixelsToUnits;
      const minimumPairWidth = minimumWidth + minimumAdjacentWidth;
      if (minimumPairWidth > pairWidth) {
        const scale = pairWidth / minimumPairWidth;
        minimumWidth *= scale;
        minimumAdjacentWidth *= scale;
      }
      const maximumWidth = columnDefinition.maxWidth * pixelsToUnits;
      const maximumAdjacentWidth = adjacentDefinition.maxWidth * pixelsToUnits;
      const lowerBound = Math.max(minimumWidth, pairWidth - maximumAdjacentWidth);
      const upperBound = Math.min(maximumWidth, pairWidth - minimumAdjacentWidth);
      const nextWidth = Math.min(
        Math.max(startWidth + deltaPixels * pixelsToUnits, lowerBound),
        upperBound,
      );

      setColumnWidths(current => ({
        ...current,
        [column]: Number(nextWidth.toFixed(3)),
        [adjacentColumn]: Number((pairWidth - nextWidth).toFixed(3)),
      }));
    },
    [],
  );

  const handleColumnResizePointerDown = useCallback(
    (column: TicketListColumnKey, event: React.PointerEvent<HTMLButtonElement>): void => {
      if (event.button !== 0) return;
      const columnIndex = TICKET_LIST_COLUMNS.findIndex(item => item.key === column);
      const adjacentColumn = TICKET_LIST_COLUMNS[columnIndex + 1];
      if (!adjacentColumn) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeDragRef.current = {
        column,
        adjacentColumn: adjacentColumn.key,
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: columnWidths[column],
        startAdjacentWidth: columnWidths[adjacentColumn.key],
        availableWidth: getAvailableColumnsWidth(),
        totalWidthUnits: totalColumnUnits,
        handle: event.currentTarget,
        previousCursor: document.body.style.cursor,
        previousUserSelect: document.body.style.userSelect,
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      setResizingColumn(column);
    },
    [columnWidths, getAvailableColumnsWidth, totalColumnUnits],
  );

  const handleColumnResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      const drag = resizeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      resizeColumnPair(
        drag.column,
        drag.adjacentColumn,
        drag.startWidth,
        drag.startAdjacentWidth,
        event.clientX - drag.startX,
        drag.availableWidth,
        drag.totalWidthUnits,
      );
    },
    [resizeColumnPair],
  );

  const handleColumnResizeEnd = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      const drag = resizeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.handle.hasPointerCapture(event.pointerId)) {
        drag.handle.releasePointerCapture(event.pointerId);
      }
      document.body.style.cursor = drag.previousCursor;
      document.body.style.userSelect = drag.previousUserSelect;
      resizeDragRef.current = null;
      setResizingColumn(null);
    },
    [],
  );

  const handleColumnResizeKeyDown = useCallback(
    (column: TicketListColumnKey, event: React.KeyboardEvent<HTMLButtonElement>): void => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const columnIndex = TICKET_LIST_COLUMNS.findIndex(item => item.key === column);
      const adjacentColumn = TICKET_LIST_COLUMNS[columnIndex + 1];
      if (!adjacentColumn) return;
      event.preventDefault();
      resizeColumnPair(
        column,
        adjacentColumn.key,
        columnWidths[column],
        columnWidths[adjacentColumn.key],
        event.key === 'ArrowRight' ? 8 : -8,
        getAvailableColumnsWidth(),
        totalColumnUnits,
      );
    },
    [columnWidths, getAvailableColumnsWidth, resizeColumnPair, totalColumnUnits],
  );

  const pageStart = pageCursors[pageIndex] ?? null;
  const [firstPage, firstPageDetails] = useCachedQuery(
    queries.supportTicketsPageV3({
      channelId,
      isMember,
      assignedTo,
      createdBy,
      priority,
      stageName,
      aiCategory,
      ...(conversationIdWhitelist !== undefined
        ? { conversationIds: conversationIdWhitelist }
        : {}),
      hasAiDraft,
      hasSubTickets,
      lastEmailAtStart,
      lastEmailAtEnd,
      createdAtStart,
      createdAtEnd,
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
        cb: createdBy ?? null,
        p: priority ?? null,
        s: stageName ?? null,
        ac: aiCategory ?? null,
        ci: conversationIdWhitelist ?? null,
        ad: hasAiDraft ?? null,
        hst: hasSubTickets ?? null,
        mf: mailboxFolder ?? null,
        g: userGroups ?? null,
        ds: lastEmailAtStart ?? null,
        de: lastEmailAtEnd ?? null,
        cs: createdAtStart ?? null,
        ce: createdAtEnd ?? null,
        df: dynamicFieldEntries ?? null,
        l: conversationLabelId ?? null,
      }),
    [
      channelId,
      assignedTo,
      createdBy,
      priority,
      stageName,
      aiCategory,
      conversationIdWhitelist,
      hasAiDraft,
      hasSubTickets,
      mailboxFolder,
      userGroups,
      lastEmailAtStart,
      lastEmailAtEnd,
      createdAtStart,
      createdAtEnd,
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
      totalListHeightChanged={setBodyContentHeight}
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
            gridTemplate={ticketListGridTemplate}
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
                      stageName: row.stageName,
                      priority: row.priority,
                      assignedTo: row.assignedTo,
                      userGroupId: row.userGroupId,
                      boardId: row.boardId,
                      projectId: row.projectId,
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
      stageName: t.stageName,
      priority: t.priority,
      assignedTo: t.assignedTo,
      userGroupId: t.userGroupId,
      boardId: t.boardId,
      projectId: t.projectId,
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
        className='flex items-center justify-between gap-2 px-6 py-2'
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
      <div ref={tableWrapperRef} className='relative flex-1 min-h-0 min-w-0'>
        <div className='flex h-full min-w-0 flex-col'>
          <div
            ref={columnHeadersRef}
            role='row'
            data-slot='ticket-list-column-headers'
            className='grid shrink-0 items-center gap-x-3 px-6 py-1.5'
            style={{
              gridTemplateColumns: ticketListGridTemplate,
              paddingRight: TICKET_LIST_COLUMN_PADDING_X + scrollbarGutter,
            }}
          >
            {showSelectionColumn && <div aria-hidden='true' />}
            {TICKET_LIST_COLUMNS.map(column => (
              <div
                key={column.key}
                role='columnheader'
                className={cn(
                  'flex h-6 min-w-0 items-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground',
                  getTicketListColumnAlignClass(column.key),
                )}
              >
                <span className='min-w-0 truncate'>{column.label}</span>
              </div>
            ))}
          </div>
          <div className='flex-1 min-h-0'>{list}</div>
        </div>
        {/* One divider per boundary, spanning header + rows, so hovering anywhere along a
            boundary highlights the whole line. Capped at the real table height — the list
            wrapper is `flex-1`, so `inset-0` would draw past the last ticket. */}
        <div
          className='pointer-events-none absolute inset-x-0 top-0 z-10 grid gap-x-3 px-6'
          style={{
            height: headerHeight + Math.min(bodyContentHeight, listViewportHeight),
            gridTemplateColumns: ticketListGridTemplate,
            paddingRight: TICKET_LIST_COLUMN_PADDING_X + scrollbarGutter,
          }}
        >
          {showSelectionColumn && <span aria-hidden='true' />}
          {TICKET_LIST_COLUMNS.map((column, columnIndex) => (
            <span key={column.key} className='relative'>
              {columnIndex < TICKET_LIST_COLUMNS.length - 1 && (
                <button
                  type='button'
                  role='slider'
                  aria-label={`Resize ${column.label} column`}
                  aria-orientation='horizontal'
                  aria-valuemin={column.minWidth}
                  aria-valuemax={column.maxWidth}
                  aria-valuenow={columnPixelWidth(column.key)}
                  title={`Drag to move the ${column.label} column boundary`}
                  onPointerDown={event => handleColumnResizePointerDown(column.key, event)}
                  onPointerMove={handleColumnResizePointerMove}
                  onPointerUp={handleColumnResizeEnd}
                  onPointerCancel={handleColumnResizeEnd}
                  onLostPointerCapture={handleColumnResizeEnd}
                  onKeyDown={event => handleColumnResizeKeyDown(column.key, event)}
                  data-track-category='Support'
                  data-track-name='ResizeTicketListColumn'
                  data-track-metadata={JSON.stringify({ column: column.key })}
                  className='group pointer-events-auto absolute -right-3 inset-y-0 w-3 cursor-col-resize touch-none select-none border-0 bg-transparent p-0 outline-none'
                >
                  <span
                    className={cn(
                      'absolute left-1/2 inset-y-0 w-0.5 -translate-x-1/2 bg-border/50 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary',
                      resizingColumn === column.key && 'bg-primary',
                    )}
                  />
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
