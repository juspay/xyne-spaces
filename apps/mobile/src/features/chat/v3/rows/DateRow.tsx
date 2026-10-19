import { type ReactElement } from 'react';
import { View } from 'react-native';

import { DatePillBadge, formatDatePill } from '@/src/components/chat/date-pill/date-pill';
import { recordDateSeparatorLayout } from '../list/dateSeparatorObservation';
import type { ChatRow } from '../model/chatRow.types';
import { DATE_ROW_HEIGHT } from '../model/measureRowHeight';

export function DateRow({ row }: { row: Extract<ChatRow, { type: 'date' }> }): ReactElement {
  const dateText = formatDatePill(row.date);
  return (
    <View className='items-center justify-center px-4' style={{ height: DATE_ROW_HEIGHT }}>
      <DatePillBadge
        key={`date-pill-${dateText}`}
        dateText={dateText}
        onLayout={layout => recordDateSeparatorLayout('inline', row.id, row.date, dateText, layout)}
      />
    </View>
  );
}
