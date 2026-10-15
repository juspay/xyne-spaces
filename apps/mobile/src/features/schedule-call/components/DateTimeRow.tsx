import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar, Clock } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';
import { formatDate, formatTime, type PickerMode } from '@/src/utils/timeSelection';

interface DateTimeRowProps {
  label: string;
  /** Muted text after the label, e.g. the call length. */
  hint?: string;
  value: Date;
  onDateChange: (date: Date) => void;
  onTimeChange: (time: Date) => void;
  error?: string | null;
}

const startOfToday = (): Date => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

interface PillProps {
  icon: ReactElement;
  text: string;
  isActive: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}

const Pill = ({ icon, text, isActive, accessibilityLabel, onPress }: PillProps): ReactElement => {
  const { accentText } = useBubbleAccent();
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      className='flex-row items-center gap-2 rounded-full border border-transparent bg-secondary px-3 py-2 active:opacity-70'
      style={isActive ? { borderColor: accentText } : undefined}
    >
      {icon}
      <Text className='text-sm text-foreground'>{text}</Text>
    </Pressable>
  );
};

/**
 * "Starts" / "Ends" row: a date pill and a time pill. Each opens the platform's native picker:
 * the inline calendar and time wheel on iOS, the system dialogs on Android.
 */
const DateTimeRowBase = ({
  label,
  hint,
  value,
  onDateChange,
  onTimeChange,
  error,
}: DateTimeRowProps): ReactElement => {
  const [picker, setPicker] = useState<PickerMode>(null);
  const { theme } = useUniwind();
  const { accentText } = useBubbleAccent();
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const dangerColor = useCSSVariable('--color-status-danger') as string;

  // A fresh Date each render would re-send the native `minimumDate` prop every time.
  const minimumDate = useMemo(startOfToday, []);

  const toggle = useCallback((next: Exclude<PickerMode, null>): void => {
    setPicker(current => (current === next ? null : next));
  }, []);

  const handleChange = useCallback(
    (mode: Exclude<PickerMode, null>, picked: Date): void => {
      if (Platform.OS === 'android') setPicker(null);
      if (mode === 'date') onDateChange(picked);
      else onTimeChange(picked);
    },
    [onDateChange, onTimeChange],
  );

  const sharedProps = {
    value,
    accentColor: accentText,
    themeVariant: theme === 'dark' ? ('dark' as const) : ('light' as const),
    onDismiss: (): void => setPicker(null),
  };

  return (
    <View className='px-4 py-3'>
      <Text className='mb-2 text-sm' style={{ color: descriptionColor }}>
        {label}
        {hint ? ` · ${hint}` : ''}
      </Text>
      <View className='flex-row flex-wrap gap-2'>
        <Pill
          icon={<Calendar size={16} color={descriptionColor} />}
          text={formatDate(value)}
          isActive={picker === 'date'}
          accessibilityLabel={`${label} date`}
          onPress={() => toggle('date')}
        />
        <Pill
          icon={<Clock size={16} color={descriptionColor} />}
          text={formatTime(value)}
          isActive={picker === 'time'}
          accessibilityLabel={`${label} time`}
          onPress={() => toggle('time')}
        />
      </View>

      {error ? (
        <Text
          className='mt-2 text-xs'
          style={{ color: dangerColor }}
          accessibilityLiveRegion='polite'
        >
          {error}
        </Text>
      ) : null}

      {picker ? (
        <View className={cn(Platform.OS === 'ios' && 'mt-2 overflow-hidden rounded-2xl')}>
          <DateTimePicker
            {...sharedProps}
            mode={picker}
            display={Platform.OS === 'ios' ? (picker === 'date' ? 'inline' : 'spinner') : 'default'}
            onValueChange={(_event, picked) => handleChange(picker, picked)}
            {...(picker === 'date' ? { minimumDate } : {})}
          />
        </View>
      ) : null}
    </View>
  );
};

/** Memoised so a tick of one row's picker does not re-render the other row. */
export const DateTimeRow = memo(DateTimeRowBase);
DateTimeRow.displayName = 'DateTimeRow';
