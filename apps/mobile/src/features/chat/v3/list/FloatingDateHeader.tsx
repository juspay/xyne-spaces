import { type ReactElement } from 'react';
import { View } from 'react-native';

import { DatePillBadge, formatDatePill } from '@/src/components/chat/date-pill/date-pill';
import { recordDateSeparatorLayout } from './dateSeparatorObservation';

export function FloatingDateHeader({ date }: { date: number | null }): ReactElement | null {
  if (date === null) {
    return null;
  }
  const dateText = formatDatePill(date);
  return (
    <View pointerEvents='none' className='absolute left-0 right-0 top-2 z-10 items-center'>
      <DatePillBadge
        key={`date-pill-${dateText}`}
        dateText={dateText}
        onLayout={layout => recordDateSeparatorLayout('floating', null, date, dateText, layout)}
      />
    </View>
  );
}
