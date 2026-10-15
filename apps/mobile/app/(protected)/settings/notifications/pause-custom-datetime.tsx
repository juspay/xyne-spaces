import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatPauseDate, formatPauseTime } from '@/src/utils/pauseNotifications';

import type { PauseCustomDateTimeAndroidProps } from './pause-custom-datetime.types';

export type { PauseCustomDateTimeAndroidProps as PauseCustomDateTimePickerProps };

/** Android: Date and Time rows that open the system calendar / clock dialogs. */
export function PauseCustomDateTimePicker({
  value,
  labelColor,
  descriptionColor,
  dividerColor,
  onPressDate,
  onPressTime,
}: PauseCustomDateTimeAndroidProps): ReactElement {
  return (
    <>
      <Pressable
        onPress={onPressDate}
        accessibilityRole='button'
        accessibilityLabel='Choose custom date'
        android_ripple={{ color: dividerColor }}
        style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
      >
        <View className='min-h-[52px] flex-row items-center px-4'>
          <Text className='flex-1 text-[17px]' style={{ color: labelColor }}>
            Date
          </Text>
          <Text className='text-[17px]' style={{ color: descriptionColor }}>
            {formatPauseDate(value)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onPressTime}
        accessibilityRole='button'
        accessibilityLabel='Choose custom time'
        android_ripple={{ color: dividerColor }}
        style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
      >
        <View className='min-h-[52px] flex-row items-center px-4'>
          <Text className='flex-1 text-[17px]' style={{ color: labelColor }}>
            Time
          </Text>
          <Text className='text-[17px]' style={{ color: descriptionColor }}>
            {formatPauseTime(value)}
          </Text>
        </View>
      </Pressable>
    </>
  );
}
