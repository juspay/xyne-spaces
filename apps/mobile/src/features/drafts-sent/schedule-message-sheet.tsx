import DateTimePicker from '@react-native-community/datetimepicker';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Calendar, Check, Clock } from 'lucide-react-native';
import { useCallback, type ReactElement } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';

import { SCHEDULE_PRESETS, formatScheduleConfirmCopy } from './schedule-message-utils';
import { useSchedulePicker } from './use-schedule-picker';

export type ScheduleSheetMode = 'create' | 'reschedule';

export type ScheduleMessageSheetProps = {
  isOpen: boolean;
  mode: ScheduleSheetMode;
  initialScheduledFor?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (scheduledFor: number) => Promise<void> | void;
};

export function ScheduleMessageSheet({
  isOpen,
  mode,
  initialScheduledFor,
  onOpenChange,
  onConfirm,
}: ScheduleMessageSheetProps): ReactElement {
  const insets = useSafeAreaInsets();
  const { accentBg, accentFg } = useBubbleAccent();
  const foreground = useCSSVariable('--color-foreground') as string;
  const border = useCSSVariable('--color-border') as string;
  const close = useCallback((): void => {
    onOpenChange(false);
  }, [onOpenChange]);
  const {
    view,
    customDateTime,
    pendingScheduledFor,
    pickerMode,
    isSubmitting,
    pickerValue,
    goToConfirm,
    submit,
    openCustom,
    backToPresets,
    togglePicker,
    closePicker,
    handlePickerChange,
  } = useSchedulePicker({ isOpen, initialScheduledFor, onConfirm, onDone: close });

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      mode='dynamic'
      backdropOpacity={0.42}
      animationDuration={240}
    >
      <BottomSheetScrollView
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <View className='px-4 pb-2'>
          <Text className='pb-3 text-[17px] font-semibold text-foreground'>
            {mode === 'reschedule' ? 'Reschedule message' : 'Schedule message'}
          </Text>

          {view === 'presets' ? (
            <View className='overflow-hidden rounded-2xl border' style={{ borderColor: border }}>
              {SCHEDULE_PRESETS.map((preset, index) => (
                <Pressable
                  key={preset.id}
                  accessibilityRole='button'
                  accessibilityLabel={preset.label}
                  onPress={() => goToConfirm(preset.getTime())}
                  className={cn(
                    'flex-row items-center gap-3 px-4 py-4 active:bg-accent',
                    index > 0 ? 'border-t border-border' : '',
                  )}
                >
                  <Clock size={18} color={foreground} />
                  <Text className='flex-1 text-[16px] text-foreground'>{preset.label}</Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Custom time'
                onPress={openCustom}
                className='flex-row items-center gap-3 border-t border-border px-4 py-4 active:bg-accent'
              >
                <Calendar size={18} color={foreground} />
                <Text className='flex-1 text-[16px] text-foreground'>Custom...</Text>
              </Pressable>
            </View>
          ) : null}

          {view === 'custom' ? (
            <View>
              <View className='overflow-hidden rounded-2xl border' style={{ borderColor: border }}>
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel='Choose date'
                  onPress={() => togglePicker('date')}
                  className={cn(
                    'flex-row items-center gap-3 px-4 py-4 active:bg-accent',
                    pickerMode === 'date' ? 'bg-accent/60' : '',
                  )}
                >
                  <Calendar size={18} color={foreground} />
                  <Text className='flex-1 text-[16px] text-foreground'>
                    {customDateTime.toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      weekday: 'short',
                    })}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel='Choose time'
                  onPress={() => togglePicker('time')}
                  className={cn(
                    'flex-row items-center gap-3 border-t border-border px-4 py-4 active:bg-accent',
                    pickerMode === 'time' ? 'bg-accent/60' : '',
                  )}
                >
                  <Clock size={18} color={foreground} />
                  <Text className='flex-1 text-[16px] text-foreground'>
                    {customDateTime.toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </Text>
                </Pressable>
              </View>

              {pickerMode ? (
                <View className='mt-3 overflow-hidden rounded-2xl bg-card'>
                  <DateTimePicker
                    value={pickerValue}
                    mode={pickerMode}
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    {...(pickerMode === 'date' ? { minimumDate: new Date() } : {})}
                    onChange={handlePickerChange}
                  />
                  {Platform.OS === 'ios' ? (
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel='Done selecting schedule time'
                      onPress={closePicker}
                      className='items-center border-t border-foreground/10 py-3 active:opacity-70'
                    >
                      <View className='flex-row items-center gap-1.5'>
                        <Check size={16} color={foreground} strokeWidth={2.5} />
                        <Text className='text-[15px] font-medium text-foreground'>Done</Text>
                      </View>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Continue'
                onPress={() => goToConfirm(customDateTime.getTime())}
                className='mt-4 h-12 items-center justify-center rounded-xl active:opacity-80'
                style={{ backgroundColor: accentBg }}
              >
                <Text className='text-[16px] font-semibold' style={{ color: accentFg }}>
                  Continue
                </Text>
              </Pressable>
            </View>
          ) : null}

          {view === 'confirm' && pendingScheduledFor !== null ? (
            <View>
              <Text className='pb-4 text-[15px] leading-6 text-foreground'>
                {formatScheduleConfirmCopy(pendingScheduledFor, mode)}
              </Text>
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={mode === 'reschedule' ? 'Reschedule' : 'Schedule'}
                disabled={isSubmitting}
                onPress={() => void submit()}
                className='h-12 items-center justify-center rounded-xl active:opacity-80 disabled:opacity-60'
                style={{ backgroundColor: accentBg }}
              >
                <Text className='text-[16px] font-semibold' style={{ color: accentFg }}>
                  {mode === 'reschedule' ? 'Reschedule' : 'Schedule'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Back'
                onPress={backToPresets}
                className='mt-2 h-12 items-center justify-center rounded-xl active:opacity-80'
              >
                <Text className='text-[16px] text-secondary-foreground'>Back</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}
