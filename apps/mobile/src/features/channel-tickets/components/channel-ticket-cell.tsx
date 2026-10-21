import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { Calendar } from 'lucide-react-native';

import Avatar from '@/src/components/ui/avatar';
// Deep import, not the barrel: the barrel also exports the priority sheet, which
// would drag @gorhom/bottom-sheet and Reanimated into every cell render.
import { TicketsPriorityIcon } from '@/src/features/xyne-desks/tickets/components/tickets-priority-filter/tickets-priority-icon';

import { CHANNEL_TICKETS_CELL_PADDING_X } from '../constants';
import type {
  ChannelTicketColumnAlign,
  ChannelTicketColumnKey,
  ChannelTicketRow,
  ChannelTicketsLookups,
  ChannelTicketsPalette,
} from '../types';
import { getTicketStatusStyle } from '../utils';

type ChannelTicketCellProps = {
  row: ChannelTicketRow;
  columnKey: ChannelTicketColumnKey;
  align: ChannelTicketColumnAlign;
  width: number;
  palette: ChannelTicketsPalette;
  lookups: ChannelTicketsLookups;
};

const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

const Muted = ({ label, color }: { label: string; color: string }): ReactElement => (
  <Text className='text-[13px]' style={{ color }} numberOfLines={1}>
    {label}
  </Text>
);

/**
 * One table cell. Pure: everything it shows comes from the pre-formatted row,
 * the resolved palette and the id → name lookups. No hooks, no global state.
 */
function renderCell(
  row: ChannelTicketRow,
  columnKey: ChannelTicketColumnKey,
  palette: ChannelTicketsPalette,
  lookups: ChannelTicketsLookups,
): ReactElement {
  switch (columnKey) {
    case 'ticket':
      return (
        <View className='min-w-0'>
          <Text
            className='font-mono text-[11px] font-medium'
            style={{ color: palette.secondary }}
            numberOfLines={1}
          >
            {row.xyneId}
          </Text>
          <Text
            className='text-[14px] font-medium'
            style={{ color: palette.foreground }}
            numberOfLines={1}
          >
            {row.title}
          </Text>
        </View>
      );
    case 'board':
      return (
        <Muted
          label={lookups.boardNameById.get(row.boardId) ?? (row.boardId ? '…' : '—')}
          color={palette.foreground}
        />
      );
    case 'status': {
      const style = getTicketStatusStyle(row.statusV2);
      const color = palette.byVar.get(style.colorVar) ?? palette.secondary;
      const backgroundColor = palette.byVar.get(style.softBgVar) ?? 'transparent';
      return (
        <View className='self-start rounded-md px-2 py-0.5' style={{ backgroundColor }}>
          <Text className='text-[12px] font-semibold' style={{ color }} numberOfLines={1}>
            {style.label}
          </Text>
        </View>
      );
    }
    case 'priority':
      if (!row.priority) return <Muted label='—' color={palette.secondary} />;
      return (
        <View className='flex-row items-center gap-1.5'>
          <TicketsPriorityIcon priority={row.priority} size={14} />
          <Text className='text-[13px]' style={{ color: palette.foreground }} numberOfLines={1}>
            {PRIORITY_LABEL[row.priority] ?? row.priority}
          </Text>
        </View>
      );
    case 'assignee':
      if (!row.assignee) return <Muted label='Unassigned' color={palette.secondary} />;
      if (row.assignee.kind === 'group') {
        return (
          <Muted
            label={lookups.groupNameById.get(row.assignee.id) ?? 'Group'}
            color={palette.foreground}
          />
        );
      }
      return (
        <View className='flex-row items-center gap-2'>
          <Avatar userIds={[row.assignee.id]} size={22} />
          <Text
            className='min-w-0 shrink text-[13px]'
            style={{ color: palette.foreground }}
            numberOfLines={1}
          >
            {lookups.userNameById.get(row.assignee.id) ?? 'Unknown'}
          </Text>
        </View>
      );
    case 'dueDate': {
      const color = row.isDueUrgent ? palette.urgent : palette.secondary;
      return (
        <View className='flex-row items-center gap-1.5'>
          <Calendar size={13} color={color} strokeWidth={2} />
          <Text
            className='text-[13px]'
            style={{ color }}
            numberOfLines={1}
            accessibilityLabel={row.isDueUrgent ? `Overdue ${row.dueDateLabel}` : undefined}
          >
            {row.dueDateLabel}
          </Text>
        </View>
      );
    }
    case 'stage':
      return <Muted label={row.stageName ?? '—'} color={palette.foreground} />;
    case 'createdAt':
      return <Muted label={row.createdAtLabel} color={palette.secondary} />;
    case 'age':
      return <Muted label={row.ageLabel} color={palette.secondary} />;
  }
}

export const ChannelTicketCell = memo(function ChannelTicketCell({
  row,
  columnKey,
  align,
  width,
  palette,
  lookups,
}: ChannelTicketCellProps): ReactElement {
  return (
    <View
      className='justify-center'
      testID={`channel-ticket-cell-${columnKey}`}
      style={{
        width,
        paddingHorizontal: CHANNEL_TICKETS_CELL_PADDING_X,
        alignItems: align === 'center' ? 'center' : 'flex-start',
      }}
    >
      {renderCell(row, columnKey, palette, lookups)}
    </View>
  );
});
