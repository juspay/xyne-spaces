import { type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatChatDateLabel } from './date-pill.utils';

export const formatDatePill = (date: Date | number): string =>
  formatChatDateLabel(date, { relativeLabels: true, order: 'month-day', year: 'auto' });

export interface DatePillProps {
  dateText: string;
  onLayout?: ((layout: { width: number; height: number }) => void) | undefined;
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'center',
    borderRadius: 999,
    flexShrink: 0,
  },
  text: {
    flexShrink: 0,
  },
});

export const DatePillBadge = ({ dateText, onLayout }: DatePillProps): ReactElement => (
  <View
    collapsable={false}
    className='rounded-full border-[0.5px] border-foreground/15 bg-card px-3 py-1'
    onLayout={event => onLayout?.(event.nativeEvent.layout)}
    style={styles.badge}
  >
    <Text className='text-xs font-medium text-foreground' numberOfLines={1} style={styles.text}>
      {dateText}
    </Text>
  </View>
);

export const DatePill = ({ dateText, onLayout }: DatePillProps): ReactElement => (
  <View className='items-center justify-center py-2'>
    <DatePillBadge key={`date-pill-${dateText}`} dateText={dateText} onLayout={onLayout} />
  </View>
);
