import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { cn } from '../../../utils/classNames';
import { Skeleton } from '../../ui/Skeleton';
import { TicketListRow } from './TicketListRow';
import { queries } from '../../../zero/queries';
import { useShortcut } from '../../../shortcuts';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { dataLoadDuration, safeRecordMetric } from '../../../services/otel';
import { logger, Event } from '../../../utils/logger';
import type { QueryResultType } from '@rocicorp/zero';
import type { TicketListItem } from './TicketListView.types';
import { TicketPriority } from '@xyne/shared';

const PAGE_SIZE = 50;
const SCROLL_INDEX_POSITIONS = new Map<string, number>();

export type SupportTicketRow = NonNullable<
  QueryResultType<typeof queries.supportTicketsPageV3>[number]
>;

interface TicketListViewProps {
  filter: {
    channelId: string;
    assignedTo?: string[] | undefined;
    priority?: TicketPriority[] | undefined;
    stageName?: string[] | undefined;
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
}

export interface SelectableRow {
  id: string;
  lastEmailAt: number;
  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }>;
}

/** Imperative handle exposed to parent via ref — used for "Select All". */
export interface TicketListViewHandle {
  /** Returns all rows currently loaded in the list (merged first page + older pages). */
  getLoadedRows: () => SelectableRow[];
}

export const TicketListView = React.forwardRef<TicketListViewHandle, TicketListViewProps>(
  function TicketListView(
    {
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
    }: TicketListViewProps,
    ref,
  ): React.ReactElement {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const zero = useZero();

    const { channelId, assignedTo, priority, stageName } = filter;

    const [firstPage, firstPageDetails] = useCachedQuery(
      queries.supportTicketsPageV3({
        channelId,
        isMember,
        assignedTo,
        priority,
        stageName,
        limit: PAGE_SIZE,
        start: null,
        dir: 'forward',
      }),
    );

    const [olderPages, setOlderPages] = useState<SupportTicketRow[][]>([]);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const loadStartTimeRef = useRef<number | null>(Date.now());

    // Filter key — reset accumulator when filter changes (new view = new data).
    const filterKey = useMemo(
      () =>
        JSON.stringify({
          c: channelId,
          a: assignedTo ?? null,
          p: priority ?? null,
          s: stageName ?? null,
        }),
      [channelId, assignedTo, priority, stageName],
    );

    useEffect(() => {
      setOlderPages([]);
      setHasMore(true);
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

    const tickets = useMemo<SupportTicketRow[]>(() => {
      const all = [...((firstPage as SupportTicketRow[] | undefined) ?? []), ...olderPages.flat()];
      const seen = new Set<string>();
      const unique: SupportTicketRow[] = [];
      for (const t of all) {
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
    }, [firstPage, olderPages]);

    const complete = firstPageDetails.type === 'complete';
    const rowsEmpty = complete && tickets.length === 0;
    const showInitialSkeletons = !complete && tickets.length === 0;
    const loadMore = useCallback(async () => {
      if (!hasMore || isLoadingMore) return;
      const last = tickets[tickets.length - 1];
      if (!last) return;
      setIsLoadingMore(true);
      try {
        const next = (await zero.run(
          queries.supportTicketsPageV3({
            channelId,
            isMember,
            assignedTo,
            priority,
            stageName,
            limit: PAGE_SIZE,
            start: { id: last.id, lastEmailAt: last.lastEmailAt },
            dir: 'forward',
          }),
          { type: 'complete' },
        )) as SupportTicketRow[];
        if (next.length === 0) {
          setHasMore(false);
        } else {
          setOlderPages(prev => [...prev, next]);
          if (next.length < PAGE_SIZE) setHasMore(false);
        }
      } finally {
        setIsLoadingMore(false);
      }
    }, [
      tickets,
      hasMore,
      isLoadingMore,
      zero,
      channelId,
      isMember,
      assignedTo,
      priority,
      stageName,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        getLoadedRows: (): SelectableRow[] =>
          tickets.map(t => {
            const entry: SelectableRow = { id: t.id, lastEmailAt: t.lastEmailAt };
            const emailReads = t.emailReads as
              | ReadonlyArray<{ userId: string; lastReadEmailAt: number }>
              | undefined;
            if (emailReads !== undefined) {
              entry.emailReads = emailReads;
            }
            return entry;
          }),
      }),
      [tickets],
    );

    const firstRowBoardId = tickets[0]?.boardId;
    useEffect(() => {
      if (firstRowBoardId) onBoardIdReady?.(firstRowBoardId);
    }, [firstRowBoardId, onBoardIdReady]);

    // Scroll restoration via Virtuoso's initialTopMostItemIndex + rangeChanged.
    const restoredIndex = SCROLL_INDEX_POSITIONS.get(filterKey) ?? 0;
    const hasRestoredRef = useRef(false);
    useEffect(() => {
      hasRestoredRef.current = false;
    }, [filterKey]);

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

    return (
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
        className={cn('h-full w-full outline-none', className)}
        initialTopMostItemIndex={restoredIndex}
        rangeChanged={range => {
          if (!hasRestoredRef.current) {
            hasRestoredRef.current = true;
            return;
          }
          SCROLL_INDEX_POSITIONS.set(filterKey, range.startIndex);
        }}
        endReached={() => void loadMore()}
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
  },
);
