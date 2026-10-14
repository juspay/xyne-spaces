import { memo, useCallback, type ReactElement } from 'react';
import { Pressable } from 'react-native';
import type { Row } from '@tanstack/react-table';

import { haptics } from '@/src/utils/haptics';

import { getChannelTicketColumnMeta } from '../columns';
import { CHANNEL_TICKETS_ROW_HEIGHT } from '../constants';
import type { ChannelTicketRow, ChannelTicketsLookups, ChannelTicketsPalette } from '../types';
import { ChannelTicketCell } from './channel-ticket-cell';

type ChannelTicketsRowProps = {
  row: Row<ChannelTicketRow>;
  palette: ChannelTicketsPalette;
  lookups: ChannelTicketsLookups;
  onPress: (ticket: ChannelTicketRow) => void;
};

/**
 * One table row: fixed height for LegendList recycling, cells from TanStack's
 * visible-cell model. Pure: props are pre-formatted data and callbacks.
 */
export const ChannelTicketsRow = memo(function ChannelTicketsRow({
  row,
  palette,
  lookups,
  onPress,
}: ChannelTicketsRowProps): ReactElement {
  const ticket = row.original;

  const handlePress = useCallback(() => {
    void haptics.buttonTap();
    onPress(ticket);
  }, [onPress, ticket]);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`${ticket.xyneId} ${ticket.title}`}
      testID={`channel-ticket-row-${ticket.id}`}
      onPress={handlePress}
      className='flex-row items-center border-b border-ticket-table-divider bg-card active:bg-secondary'
      style={{ height: CHANNEL_TICKETS_ROW_HEIGHT }}
    >
      {row.getVisibleCells().map(cell => {
        const meta = getChannelTicketColumnMeta(cell.column.columnDef.meta);
        if (!meta) return null;
        return (
          <ChannelTicketCell
            key={cell.id}
            row={ticket}
            columnKey={meta.key}
            align={meta.align}
            width={cell.column.getSize()}
            palette={palette}
            lookups={lookups}
          />
        );
      })}
    </Pressable>
  );
});
