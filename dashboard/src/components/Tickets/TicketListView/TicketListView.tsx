import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useZeroVirtualizer } from '@rocicorp/zero-virtual/react';
import { cn } from '../../../utils/classNames';
import { Skeleton } from '../../ui/Skeleton';
import { TicketListRow } from './TicketListRow';
import { queries } from '../../../zero/queries';
import { useShortcut } from '../../../shortcuts';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import type { QueryResultType } from '@rocicorp/zero';
import type { TicketListItem } from './TicketListView.types';

const ROW_HEIGHT = 45;

export type SupportTicketRow = NonNullable<
  QueryResultType<typeof queries.supportTicketsPageV2>[number]
>;

type TicketStart = { id: string; lastEmailAt: number };

interface TicketListViewProps {
  filter: {
    channelId: string;
    assignedTo?: string | undefined;
  };
  onTicketClick: (ticket: SupportTicketRow) => void;
  activeTicketId?: string | null | undefined;
  showExtraFields?: boolean;
  skeletonRowCount?: number;
  emptyState?: React.ReactNode;
  className?: string;
}

const toStartRow = (row: SupportTicketRow): TicketStart => ({
  id: row.id,
  lastEmailAt: row.lastEmailAt,
});

const getRowKey = (row: SupportTicketRow): string => row.id;

export function TicketListView({
  filter,
  onTicketClick,
  activeTicketId,
  showExtraFields = false,
  skeletonRowCount = 8,
  emptyState,
  className,
}: TicketListViewProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { channelId, assignedTo } = filter;
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
        limit,
        start,
        dir,
      }),
    }),
    [channelId, isMember, assignedTo],
  );

  const getSingleQuery = useCallback(
    ({ id }: { id: string }) => ({
      query: queries.supportTicketRowV2({ id, channelId, isMember }),
    }),
    [channelId, isMember],
  );

  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback(() => ROW_HEIGHT, []);

  const listContextParams = useMemo(() => ({ channelId, assignedTo }), [channelId, assignedTo]);

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

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const showInitialSkeletons = !complete && virtualItems.length === 0 && !rowsEmpty;

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
}
