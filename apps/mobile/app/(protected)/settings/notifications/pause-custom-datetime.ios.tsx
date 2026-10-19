import { useMemo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { DatePicker, Host } from '@expo/ui/swift-ui';
import { datePickerStyle, labelsHidden } from '@expo/ui/swift-ui/modifiers';
import { useUniwind } from 'uniwind';

import type { PauseCustomDateTimeValueProps } from './pause-custom-datetime.types';

const WHEEL_HEIGHT = 216;
const PICKER_MODIFIERS = [datePickerStyle('wheel'), labelsHidden()] as const;

/**
 * Combined date+time wheel. Expo UI's SwiftUI DatePicker with
 * `displayedComponents={['date', 'hourAndMinute']}` is one control — not two
 * separate date/time sheets.
 */
export function PauseCustomDateTimePicker({
  value,
  onChange,
}: PauseCustomDateTimeValueProps): ReactElement {
  const { theme } = useUniwind();
  const minimumDate = useMemo(() => new Date(), []);
  const pickerValue = value.getTime() > Date.now() ? value : minimumDate;

  return (
    <View style={styles.wrap} accessibilityLabel='Choose custom date and time'>
      <Host
        ignoreSafeArea='all'
        colorScheme={theme === 'dark' ? 'dark' : 'light'}
        style={styles.host}
      >
        <DatePicker
          modifiers={[...PICKER_MODIFIERS]}
          selection={pickerValue}
          displayedComponents={['date', 'hourAndMinute']}
          range={{ start: minimumDate }}
          onDateChange={onChange}
        />
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    height: WHEEL_HEIGHT,
  },
  host: {
    width: '100%',
    height: WHEEL_HEIGHT,
  },
});
