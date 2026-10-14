import { memo } from 'react';
import { Text, View } from 'react-native';
import { flexRender, type Table } from '@tanstack/react-table';

import { getChannelTicketColumnMeta } from '../columns';
import { CHANNEL_TICKETS_CELL_PADDING_X, CHANNEL_TICKETS_HEADER_ROW_HEIGHT } from '../constants';
import type { ChannelTicketRow } from '../types';

type ChannelTicketsHeaderRowProps = {
  table: Table<ChannelTicketRow>;
  textColor: string;
};

/** Sticky column headers; lives outside the vertical list so it never scrolls away. */
export const ChannelTicketsHeaderRow = memo(function ChannelTicketsHeaderRow({
  table,
  textColor,
}: ChannelTicketsHeaderRowProps) {
  return (
    <View
      className='flex-row items-center border-b border-ticket-table-divider bg-ticket-table-header-bg'
      style={{ height: CHANNEL_TICKETS_HEADER_ROW_HEIGHT }}
    >
      {table.getHeaderGroups().map(headerGroup =>
        headerGroup.headers.map(header => {
          const meta = getChannelTicketColumnMeta(header.column.columnDef.meta);
          const rendered = header.isPlaceholder
            ? null
            : flexRender(header.column.columnDef.header, header.getContext());
          return (
            <View
              key={header.id}
              className='justify-center'
              style={{
                width: header.getSize(),
                paddingHorizontal: CHANNEL_TICKETS_CELL_PADDING_X,
                alignItems: meta?.align === 'center' ? 'center' : 'flex-start',
              }}
            >
              <Text
                className='text-[12px] font-semibold uppercase tracking-wide'
                style={{ color: textColor }}
                numberOfLines={1}
              >
                {typeof rendered === 'string' ? rendered : (rendered ?? '')}
              </Text>
            </View>
          );
        }),
      )}
    </View>
  );
});
