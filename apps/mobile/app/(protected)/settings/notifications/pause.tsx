import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Fragment, useCallback, useMemo, useState, type ReactElement } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack, useRouter } from 'expo-router';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useCSSVariable } from 'uniwind';

import { usePauseNotifications } from '@/src/hooks/usePauseNotifications';
import {
  canSavePauseSelection,
  formatPauseCustomSummary,
  formatPauseUntilLabel,
  initialCustomPauseTime,
  PAUSE_NOTIFICATION_OPTIONS,
  resolvePauseUntil,
  type PauseOptionId,
} from '@/src/utils/pauseNotifications';
import { mergeDatePart, mergeTimePart } from '@/src/utils/timeSelection';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';

import { PauseCustomDateTimePicker } from './pause-custom-datetime';

type SettingsColors = {
  bg: string;
  divider: string;
  label: string;
  description: string;
  blue: string;
};

const useSettingsColors = (): SettingsColors => ({
  bg: useCSSVariable('--color-settings-bg') as string,
  divider: useCSSVariable('--color-settings-row-divider') as string,
  label: useCSSVariable('--color-settings-label') as string,
  description: useCSSVariable('--color-settings-description') as string,
  blue: useCSSVariable('--color-settings-icon-blue') as string,
});

type PickerMode = 'date' | 'time' | null;

export default function PauseNotificationsScreen(): ReactElement {
  const router = useRouter();
  const colors = useSettingsColors();
  const { isPaused, pausedUntil, setPausedUntil } = usePauseNotifications();

  const [selectedOption, setSelectedOption] = useState<PauseOptionId | null>(null);
  const [customDateTime, setCustomDateTime] = useState<Date>(() => initialCustomPauseTime());
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [isSaving, setIsSaving] = useState(false);

  const pickerValue = useMemo(
    () => (customDateTime.getTime() > Date.now() ? customDateTime : initialCustomPauseTime()),
    [customDateTime],
  );

  const canSave = !isSaving && canSavePauseSelection(selectedOption, customDateTime);

  const applyPickedDate = useCallback((picked: Date, mode: Exclude<PickerMode, null>): void => {
    setCustomDateTime(current =>
      mode === 'date' ? mergeDatePart(current, picked) : mergeTimePart(current, picked),
    );
  }, []);

  const handleAndroidPickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date): void => {
      const mode = pickerMode;
      setPickerMode(null);
      if (event.type !== 'set' || !selectedDate || !mode) return;
      applyPickedDate(selectedDate, mode);
    },
    [applyPickedDate, pickerMode],
  );

  const save = useCallback(async (): Promise<void> => {
    if (selectedOption === null || isSaving) return;
    const until = resolvePauseUntil(selectedOption, customDateTime);
    if (until <= Date.now()) {
      void haptics.warning();
      Alert.alert('Choose a future time', 'Pause until must be later than now.');
      return;
    }
    setIsSaving(true);
    try {
      await setPausedUntil(until);
      showMessageToast('Notifications paused', 'success');
      router.back();
    } catch {
      void haptics.error();
      Alert.alert('Could not pause notifications', 'Try again in a moment.');
    } finally {
      setIsSaving(false);
    }
  }, [customDateTime, isSaving, router, selectedOption, setPausedUntil]);

  const resume = useCallback(async (): Promise<void> => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await setPausedUntil(null);
      showMessageToast('Notifications resumed', 'success');
      router.back();
    } catch {
      void haptics.error();
      Alert.alert('Could not resume notifications', 'Try again in a moment.');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, router, setPausedUntil]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <Stack.Screen
        options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
      />

      <View
        className='min-h-14 flex-row items-center gap-2 border-b px-2'
        style={{ borderColor: colors.divider }}
      >
        <HeaderBackButton liquidGlass onPress={() => router.back()} iconColor={colors.label} />
        <Text
          className='flex-1 text-[20px] font-semibold'
          style={{ color: colors.label }}
          numberOfLines={1}
        >
          Pause Notifications
        </Text>
        <Pressable
          onPress={() => {
            void save();
          }}
          disabled={!canSave}
          accessibilityRole='button'
          accessibilityLabel='Save pause notifications'
          accessibilityState={{ disabled: !canSave }}
          hitSlop={8}
          style={{ paddingHorizontal: 10, paddingVertical: 8, opacity: canSave ? 1 : 0.4 }}
        >
          <Text
            className='text-[17px] font-semibold'
            style={{ color: canSave ? colors.blue : colors.description }}
          >
            Save
          </Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {isPaused && pausedUntil ? (
          <View className='px-4 pb-1 pt-4'>
            <Text className='text-[13px]' style={{ color: colors.description }}>
              Currently paused. {formatPauseUntilLabel(pausedUntil)}
            </Text>
          </View>
        ) : null}

        {PAUSE_NOTIFICATION_OPTIONS.map(option => {
          const selected = selectedOption === option.id;
          const showIosCustomSummary = Platform.OS === 'ios' && option.id === 'custom' && selected;
          return (
            <Fragment key={option.id}>
              <Pressable
                onPress={() => {
                  if (!selected) void haptics.selection();
                  setSelectedOption(option.id);
                  if (option.id !== 'custom') setPickerMode(null);
                }}
                accessibilityRole='radio'
                accessibilityState={{ checked: selected }}
                accessibilityLabel={option.label}
                android_ripple={{ color: colors.divider }}
                style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
              >
                <View className='min-h-[52px] flex-row items-center px-4'>
                  <View className='min-w-0 flex-1 py-3'>
                    <Text className='text-[17px]' style={{ color: colors.label }}>
                      {option.label}
                    </Text>
                    {showIosCustomSummary ? (
                      <Text className='mt-0.5 text-[15px]' style={{ color: colors.description }}>
                        {formatPauseCustomSummary(customDateTime)}
                      </Text>
                    ) : null}
                  </View>
                  <RadioMark
                    selected={selected}
                    color={colors.blue}
                    borderColor={colors.description}
                  />
                </View>
              </Pressable>

              {option.id === 'custom' && selectedOption === 'custom' ? (
                <PauseCustomDateTimePicker
                  value={customDateTime}
                  onChange={setCustomDateTime}
                  labelColor={colors.label}
                  descriptionColor={colors.description}
                  dividerColor={colors.divider}
                  onPressDate={() => setPickerMode(current => (current === 'date' ? null : 'date'))}
                  onPressTime={() => setPickerMode(current => (current === 'time' ? null : 'time'))}
                />
              ) : null}
            </Fragment>
          );
        })}

        {isPaused ? (
          <Pressable
            onPress={() => {
              void resume();
            }}
            disabled={isSaving}
            accessibilityRole='button'
            accessibilityLabel='Resume notifications'
            className='mt-6 items-center py-3'
          >
            <Text className='text-[17px] font-medium' style={{ color: colors.blue }}>
              Resume notifications
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {pickerMode === 'date' && Platform.OS === 'android' ? (
        <DateTimePicker
          value={pickerValue}
          mode='date'
          display='calendar'
          minimumDate={new Date()}
          onChange={handleAndroidPickerChange}
        />
      ) : null}
      {pickerMode === 'time' && Platform.OS === 'android' ? (
        <DateTimePicker
          value={pickerValue}
          mode='time'
          display='clock'
          is24Hour={false}
          onChange={handleAndroidPickerChange}
        />
      ) : null}
    </SafeAreaView>
  );
}

const RadioMark = ({
  selected,
  color,
  borderColor,
}: {
  selected: boolean;
  color: string;
  borderColor: string;
}): ReactElement => (
  <View
    style={{
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: selected ? 6 : 1.5,
      borderColor: selected ? color : borderColor,
      backgroundColor: 'transparent',
    }}
  />
);
