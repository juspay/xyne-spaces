import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useZeroVirtualizer } from '@rocicorp/zero-virtual/react';
import { cn } from '../../../utils/classNames';
import { Skeleton } from '../../ui/Skeleton';
import { TicketListRow } from './TicketListRow';
import { queries } from '../../../zero/queries';
import { useShortcut } from '../../../shortcuts';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import type { QueryResultType } from '@rocicorp/zero';
import type { TicketListItem } from './TicketListView.types';
import { TicketPriority } from '@xyne/shared';

const ROW_HEIGHT = 45;
const SCROLL_POSITIONS = new Map<string, number>();

export type SupportTicketRow = NonNullable<
  QueryResultType<typeof queries.supportTicketsPageV2>[number]
>;

type TicketStart = { id: string; lastEmailAt: number };

interface TicketListViewProps {
  filter: {
    channelId: string;
    assignedTo?: string[] | undefined;
    priority?: TicketPriority[] | undefined;
    stageName?: string[] | undefined;
  };
  onTicketClick: (ticket: SupportTicketRow) => void;
  activeTicketId?: string | null | undefined;
  showExtraFields?: boolean;
  skeletonRowCount?: number;
  emptyState?: React.ReactNode;
  className?: string;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (row: SelectableRow) => void;
  stageOptions?: ReadonlyArray<string>;
  onStageChange?: (
    ticketId: string,
    newStageName: string,
    currentStageName: string | null | undefined,
  ) => void;
}

export interface SelectableRow {
  id: string;
  emails?: ReadonlyArray<{ id: string; createdAt: number }>;
  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailId: string }>;
}

/** Imperative handle exposed to parent via ref — used for "Select All". */
export interface TicketListViewHandle {
  /** Returns all rows currently loaded in the virtualizer (have emails/emailReads data). */
  getLoadedRows: () => SelectableRow[];
}

const toStartRow = (row: SupportTicketRow): TicketStart => ({
  id: row.id,
  lastEmailAt: row.lastEmailAt,
});

const getRowKey = (row: SupportTicketRow): string => row.id;

export const TicketListView = React.forwardRef<TicketListViewHandle, TicketListViewProps>(
  function TicketListView(
    {
      filter,
      onTicketClick,
      activeTicketId,
      showExtraFields = false,
      skeletonRowCount = 8,
      emptyState,
      className,
      selectedIds,
      onToggleSelect,
      stageOptions,
      onStageChange,
    }: TicketListViewProps,
    ref,
  ): React.ReactElement {
    const scrollRef = useRef<HTMLDivElement>(null);

    const { channelId, assignedTo, priority, stageName } = filter;
    // Feeds TicketsACL fast-path (scalar EXISTS on channel_participants) instead
    // of the per-row OR(PUBLIC, EXISTS) fallback.
    const channelUserStatus = useGetChannelUserStatus(channelId);
    const isMember = !!channelUserStatus;

    const getPageQuery = useCallback(
      ({
        limit,
        start,
        dir,
      }: {
        limit: number;
        start: TicketStart | null;
        dir: 'forward' | 'backward';
      }) => ({
        query: queries.supportTicketsPageV2({
          channelId,
          isMember,
          assignedTo,
          priority,
          stageName,
          limit,
          start,
          dir,
        }),
      }),
      [channelId, isMember, assignedTo, priority, stageName],
    );

    const getSingleQuery = useCallback(
      ({ id }: { id: string }) => ({
        query: queries.supportTicketRowV2({ id, channelId, isMember }),
      }),
      [channelId, isMember],
    );

    const getScrollElement = useCallback(() => scrollRef.current, []);
    const estimateSize = useCallback(() => ROW_HEIGHT, []);

    const listContextParams = useMemo(
      () => ({ channelId, assignedTo, priority, stageName }),
      [channelId, assignedTo, priority, stageName],
    );

    const virt = useZeroVirtualizer({
      listContextParams,
      getScrollElement,
      estimateSize,
      getRowKey,
      toStartRow,
      getPageQuery,
      getSingleQuery,
    });
    const { virtualizer, rowAt, complete, rowsEmpty } = virt;

    // Expose loaded rows to parent so "Select All" only acts on rows that have
    // full emails/emailReads data (from supportTicketsPageV2), not the full
    // unloaded dataset which lacks that data.
    useImperativeHandle(
      ref,
      () => ({
        getLoadedRows: (): SelectableRow[] => {
          const count = virtualizer.options.count;
          const loaded: SelectableRow[] = [];
          for (let i = 0; i < count; i++) {
            const row = rowAt(i);
            if (!row) continue;
            const entry: SelectableRow = { id: row.id };
            if (row.emails !== undefined) {
              entry.emails = row.emails as ReadonlyArray<{ id: string; createdAt: number }>;
            }
            if (row.emailReads !== undefined) {
              entry.emailReads = row.emailReads as ReadonlyArray<{
                userId: string;
                lastReadEmailId: string;
              }>;
            }
            loaded.push(entry);
          }
          return loaded;
        },
      }),
      [virtualizer, rowAt],
    );

    const virtualItems = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();
    const showInitialSkeletons = !complete && virtualItems.length === 0 && !rowsEmpty;

    const scrollKey = useMemo(
      () =>
        JSON.stringify({
          c: channelId,
          a: assignedTo ?? null,
          p: priority ?? null,
          s: stageName ?? null,
        }),
      [channelId, assignedTo, priority, stageName],
    );

    const hasRestoredRef = useRef<string | null>(null);
    useEffect(() => {
      if (hasRestoredRef.current === scrollKey) return;
      if (totalSize <= 0) return;
      const el = scrollRef.current;
      if (!el) return;
      const saved = SCROLL_POSITIONS.get(scrollKey);
      if (typeof saved === 'number' && saved > 0) {
        el.scrollTop = saved;
      }
      hasRestoredRef.current = scrollKey;
    }, [scrollKey, totalSize]);

    const handleScroll = useCallback(
      (e: React.UIEvent<HTMLDivElement>) => {
        // Only persist after the initial restore has run — otherwise an early scroll
        // event with scrollTop=0 (mount before restore) would clobber the saved value.
        if (hasRestoredRef.current !== scrollKey) return;
        SCROLL_POSITIONS.set(scrollKey, e.currentTarget.scrollTop);
      },
      [scrollKey],
    );

    // Keyboard navigation: j/k to move, Enter to open the highlighted row.
    // Null = no row highlighted yet (first j/k starts at 0).
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const rowCount = virtualizer.options.count;

    const moveBy = useCallback(
      (delta: number) => {
        setSelectedIndex(prev => {
          const next =
            prev === null
              ? delta > 0
                ? 0
                : Math.max(0, rowCount - 1)
              : Math.max(0, Math.min(rowCount - 1, prev + delta));
          virtualizer.scrollToIndex(next, { align: 'auto' });
          return next;
        });
      },
      [rowCount, virtualizer],
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
        const row = rowAt(selectedIndex);
        if (row) onTicketClick(row);
      },
      {
        scope: 'global',
        description: 'Open selected ticket',
        category: 'Support',
        enabled: !rowsEmpty && selectedIndex !== null,
      },
    );

    return (
      <div
        ref={scrollRef}
        data-slot='ticket-list-view'
        role='list'
        aria-label='Tickets'
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onFocus={e => {
          if (e.target !== e.currentTarget) return;
          if (selectedIndex === null && !rowsEmpty) {
            setSelectedIndex(0);
          }
        }}
        onScroll={handleScroll}
        className={cn('h-full w-full overflow-y-auto outline-none', className)}
      >
        {rowsEmpty ? (
          <div className='flex items-center justify-center py-12 text-muted-foreground text-sm'>
            {emptyState ?? 'No tickets found'}
          </div>
        ) : showInitialSkeletons ? (
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
        ) : (
          <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
            {virtualItems.map(virtualRow => {
              const row = rowAt(virtualRow.index);
              const ticketIdValue = row?.xyneId || row?.id || '';
              const isActive =
                !!row &&
                (activeTicketId
                  ? activeTicketId === ticketIdValue
                  : selectedIndex !== null && virtualRow.index === selectedIndex);

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row ? (
                    <TicketListRow
                      ticket={row as TicketListItem}
                      isActive={isActive}
                      showExtraFields={showExtraFields}
                      {...(stageOptions ? { stageOptions } : {})}
                      {...(onStageChange ? { onStageChange } : {})}
                      {...(onToggleSelect
                        ? {
                            isSelected: selectedIds?.has(row.id) ?? false,
                            onToggleSelect: () => {
                              const emails = row.emails as
                                | ReadonlyArray<{ id: string; createdAt: number }>
                                | undefined;
                              const emailReads = row.emailReads as
                                | ReadonlyArray<{ userId: string; lastReadEmailId: string }>
                                | undefined;
                              onToggleSelect({
                                id: row.id,
                                ...(emails ? { emails } : {}),
                                ...(emailReads ? { emailReads } : {}),
                              });
                            },
                          }
                        : {})}
                      onClick={() => onTicketClick(row)}
                    />
                  ) : (
                    <div className='flex items-center gap-3 px-6 py-3 border-b border-border h-full'>
                      <Skeleton className='h-3.5 w-3.5 rounded-full flex-shrink-0' />
                      <Skeleton className='h-3 w-24 flex-shrink-0' />
                      <Skeleton className='h-3.5 w-full max-w-[300px]' />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);
