import { useMemo, type ReactElement } from 'react';
import { Platform, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { showMessageToast } from '@/src/utils/toast';

import { parseBucket } from '../utils/selectors';

function bucketOf(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

type BriefCalendarProps = {
  /** Every YYYY-MM-DD the user has a brief for. */
  availableDates: string[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  /** Android's system dialog was cancelled — return to the list view. */
  onDismiss: () => void;
  mutedColor: string;
  /** Selected-day tint (the brief's brand color). */
  accentColor: string;
};

/**
 * "Find a Brief" date picker on the platform's own calendar
 * (same pattern as tickets-date-filter-overlay): an inline UIDatePicker on
 * iOS, the system material calendar dialog on Android. Navigation is clamped
 * to the range that has briefs; native pickers cannot disable individual
 * days, so a day without a brief answers with a toast instead of navigating.
 */
export function BriefCalendar({
  availableDates,
  selectedDate,
  onSelect,
  onDismiss,
  mutedColor,
  accentColor,
}: BriefCalendarProps): ReactElement {
  const dateSet = useMemo(() => new Set(availableDates), [availableDates]);

  const bounds = useMemo(() => {
    const parsed = availableDates
      .map(parseBucket)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    return { earliest: parsed[0], latest: parsed[parsed.length - 1] };
  }, [availableDates]);

  const value = useMemo(
    () => parseBucket(selectedDate ?? undefined) ?? bounds.latest ?? new Date(),
    [selectedDate, bounds.latest],
  );

  if (availableDates.length === 0) {
    return (
      <Text className='px-2.5 py-2 text-[13px]' style={{ color: mutedColor }}>
        No briefs yet.
      </Text>
    );
  }

  const handleChange = (event: DateTimePickerEvent, picked?: Date): void => {
    if (event.type === 'dismissed') {
      onDismiss();
      return;
    }
    if (event.type !== 'set' || !picked) return;
    const bucket = bucketOf(picked);
    if (!dateSet.has(bucket)) {
      showMessageToast('No brief for that day.');
      if (Platform.OS === 'android') onDismiss();
      return;
    }
    onSelect(bucket);
  };

  return (
    <View className='px-1 pb-1'>
      <DateTimePicker
        value={value}
        mode='date'
        display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
        {...(bounds.earliest ? { minimumDate: bounds.earliest } : {})}
        {...(bounds.latest ? { maximumDate: bounds.latest } : {})}
        onChange={handleChange}
        accentColor={accentColor}
      />
    </View>
  );
}
