import { useCallback, useMemo, type ReactElement } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { getCoreRowModel, useReactTable, type ColumnDef, type Row } from '@tanstack/react-table';

import { CHANNEL_TICKET_COLUMNS, CHANNEL_TICKETS_TABLE_WIDTH } from '../columns';
import {
  CHANNEL_TICKETS_DRAW_DISTANCE,
  CHANNEL_TICKETS_ROW_HEIGHT,
  CHANNEL_TICKETS_TABLE_RADIUS,
} from '../constants';
import type { ChannelTicketRow, ChannelTicketsLookups, ChannelTicketsPalette } from '../types';
import { ChannelTicketsEmptyState } from './channel-tickets-empty-state';
import { ChannelTicketsHeaderRow } from './channel-tickets-header-row';
import { ChannelTicketsRow } from './channel-tickets-row';
import { ChannelTicketsSkeleton } from './channel-tickets-skeleton';

export type ChannelTicketsTableProps = {
  rows: ChannelTicketRow[];
  isEmpty: boolean;
  isInitialLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  hasActiveFilters: boolean;
  palette: ChannelTicketsPalette;
  lookups: ChannelTicketsLookups;
  bottomInset: number;
  onLoadMore: () => void;
  onPressTicket: (ticket: ChannelTicketRow) => void;
};

/**
 * Pure table view: rounded card → horizontal scroller → [sticky header row,
 * vertical LegendList]. The header sits outside the vertical list so it stays
 * at the top and scrolls horizontally in lock-step with the rows. Fixed column
 * widths, fixed row height. Colours and names arrive as props.
 */
export function ChannelTicketsTable({
  rows,
  isEmpty,
  isInitialLoading,
  hasMore,
  isLoadingMore,
  hasActiveFilters,
  palette,
  lookups,
  bottomInset,
  onLoadMore,
  onPressTicket,
}: ChannelTicketsTableProps): ReactElement {
  // TanStack wants a mutable array; the source list stays readonly.
  const columns = useMemo<ColumnDef<ChannelTicketRow, unknown>[]>(
    () => [...CHANNEL_TICKET_COLUMNS],
    [],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: row => row.id,
  });
  const tableRows = table.getRowModel().rows;

  const renderItem = useCallback(
    ({ item }: { item: Row<ChannelTicketRow> }) => (
      <ChannelTicketsRow row={item} palette={palette} lookups={lookups} onPress={onPressTicket} />
    ),
    [palette, lookups, onPressTicket],
  );
  const keyExtractor = useCallback((item: Row<ChannelTicketRow>) => item.id, []);
  const getFixedItemSize = useCallback(() => CHANNEL_TICKETS_ROW_HEIGHT, []);

  const handleEndReached = useCallback(() => {
    if (hasMore && !isLoadingMore) onLoadMore();
  }, [hasMore, isLoadingMore, onLoadMore]);

  const footer = useMemo(
    () =>
      isLoadingMore ? (
        <View className='items-center py-4' testID='channel-tickets-loading-more'>
          <ActivityIndicator color={palette.secondary} />
        </View>
      ) : null,
    [isLoadingMore, palette.secondary],
  );

  const showSkeleton = isInitialLoading && rows.length === 0;
  const showEmpty = isEmpty && rows.length === 0;

  return (
    // Card: rounded, hairline border, clipped so the sticky header and rows share
    // the same corner radius. The horizontal scroller lives inside the card.
    <View
      className='flex-1 overflow-hidden border border-ticket-table-divider bg-card'
      style={{ borderRadius: CHANNEL_TICKETS_TABLE_RADIUS }}
      testID='channel-tickets-table'
    >
      <ScrollView
        horizontal
        nestedScrollEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ minWidth: CHANNEL_TICKETS_TABLE_WIDTH, flexGrow: 1 }}
      >
        <View style={{ width: CHANNEL_TICKETS_TABLE_WIDTH, flex: 1 }}>
          {showSkeleton ? (
            <ChannelTicketsSkeleton />
          ) : (
            <>
              <ChannelTicketsHeaderRow table={table} textColor={palette.tableHeaderText} />
              <LegendList
                data={tableRows}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                recycleItems
                getFixedItemSize={getFixedItemSize}
                estimatedItemSize={CHANNEL_TICKETS_ROW_HEIGHT}
                drawDistance={CHANNEL_TICKETS_DRAW_DISTANCE}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.5}
                ListFooterComponent={footer}
                ListEmptyComponent={
                  showEmpty ? (
                    <ChannelTicketsEmptyState hasActiveFilters={hasActiveFilters} />
                  ) : null
                }
                extraData={lookups}
                style={{ flex: 1 }}
                contentContainerStyle={{
                  paddingBottom: bottomInset,
                  ...(showEmpty ? { flexGrow: 1 } : null),
                }}
              />
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
