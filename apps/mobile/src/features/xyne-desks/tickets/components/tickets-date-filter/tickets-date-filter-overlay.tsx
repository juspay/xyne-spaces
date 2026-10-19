import { memo, useCallback, useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Calendar, Check, X } from 'lucide-react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { cn } from '@/src/utils/cn';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import {
  dateStringToEndMs,
  dateStringToStartMs,
  formatShortFilterDate,
  getDatePresetRange,
  matchDatePreset,
  msToDateInputValue,
  type TicketsDatePreset,
  type TicketsDateRange,
} from '../../utils/format-date-filter-label';
import { HeaderIconButton } from '@/src/components/ui/header-icon-button';

const FOOTER_ACTIONS_HEIGHT = 52;

type TicketsDateFilterOverlayProps = {
  progress: SharedValue<number>;
  isOpen: boolean;
  /** Header title — e.g. "Created at" / "Last updated". */
  title?: string;
  /** Currently applied range (synced into draft when overlay opens). */
  dateRange: TicketsDateRange;
  onClose: () => void;
  /** Persist draft (Save) or empty (Clear), then parent closes. */
  onApply: (range: TicketsDateRange) => void;
};

type PickerTarget = 'start' | 'end' | null;

const PRESETS: { id: TicketsDatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' },
];

/**
 * Date filter overlay — mirrors dashboard DateRangeSubmenu:
 * presets + custom start/end, using @react-native-community/datetimepicker.
 */
export const TicketsDateFilterOverlay = memo(function TicketsDateFilterOverlay({
  progress,
  isOpen,
  title = 'Date',
  dateRange,
  onClose,
  onApply,
}: TicketsDateFilterOverlayProps) {
  const insets = useSafeAreaInsets();
  const { topSafeHeight, headerHeight } = useHeaderHeight();
  const { accentBg: saveBg, accentFg: saveFg } = useBubbleAccent();
  const foreground = useCSSVariable('--color-foreground') as string;
  const brand = useCSSVariable('--color-brand') as string;

  const [draft, setDraft] = useState<TicketsDateRange>(() => ({ ...dateRange }));
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);

  const footerBottomPad = Math.max(insets.bottom, 10);
  const activePreset = matchDatePreset(draft);
  const hasDraft = draft.start !== undefined || draft.end !== undefined;
  const canClear = hasDraft || dateRange.start !== undefined || dateRange.end !== undefined;

  useEffect(() => {
    if (!isOpen) {
      setPickerTarget(null);
      return;
    }
    setDraft({ ...dateRange });
    setPickerTarget(null);
  }, [isOpen, dateRange]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(progress.value, [0, 1], [18, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    setPickerTarget(null);
    onClose();
  }, [onClose]);

  const handlePreset = useCallback((preset: TicketsDatePreset) => {
    setDraft(getDatePresetRange(preset));
    setPickerTarget(null);
  }, []);

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === 'android') {
        setPickerTarget(null);
      }
      if (event.type !== 'set' || !selectedDate || !pickerTarget) return;

      const day = msToDateInputValue(selectedDate.getTime());
      setDraft(prev => {
        if (pickerTarget === 'start') {
          const start = dateStringToStartMs(day);
          const next: TicketsDateRange = { ...prev, start };
          if (next.end !== undefined && next.end < start) {
            next.end = dateStringToEndMs(day);
          }
          return next;
        }
        const end = dateStringToEndMs(day);
        const next: TicketsDateRange = { ...prev, end };
        if (next.start !== undefined && next.start > end) {
          next.start = dateStringToStartMs(day);
        }
        return next;
      });
    },
    [pickerTarget],
  );

  const handleSave = useCallback(() => {
    Keyboard.dismiss();
    setPickerTarget(null);
    onApply(draft);
  }, [draft, onApply]);

  const handleClear = useCallback(() => {
    Keyboard.dismiss();
    setPickerTarget(null);
    onApply({});
  }, [onApply]);

  const pickerValue = (() => {
    if (pickerTarget === 'start' && draft.start !== undefined) return new Date(draft.start);
    if (pickerTarget === 'end' && draft.end !== undefined) return new Date(draft.end);
    return new Date();
  })();

  const maximumDate = new Date();

  return (
    <Animated.View
      pointerEvents={isOpen ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { zIndex: 70 }, rootStyle]}
      className='bg-neutral-100 dark:bg-tabs-screen'
    >
      <View style={{ paddingTop: topSafeHeight }}>
        <View style={{ height: headerHeight }} className='flex-row items-center px-1'>
          <HeaderIconButton
            liquidGlass
            accessibilityLabel={`Close ${title} filter`}
            onPress={handleClose}
          >
            <X size={22} color={foreground} strokeWidth={2} />
          </HeaderIconButton>
          <Text className='text-[20px] font-normal text-foreground'>{title}</Text>
        </View>
      </View>

      <View
        className='flex-1 px-4 pt-2'
        style={{ paddingBottom: FOOTER_ACTIONS_HEIGHT + footerBottomPad + 16 }}
      >
        <Text className='mb-2 text-[12px] font-medium uppercase tracking-wide text-foreground/60'>
          Quick presets
        </Text>
        <View className='mb-5 flex-row flex-wrap gap-2'>
          {PRESETS.map(preset => {
            const selected = activePreset === preset.id;
            return (
              <Pressable
                key={preset.id}
                accessibilityRole='button'
                accessibilityState={{ selected }}
                onPress={() => handlePreset(preset.id)}
                className={cn(
                  'rounded-full border px-3.5 py-2 active:opacity-70',
                  selected ? '' : 'border-foreground/20 bg-transparent',
                )}
                style={selected ? { borderColor: saveBg, backgroundColor: saveBg } : undefined}
              >
                <Text
                  className={cn(
                    'text-[14px] font-medium',
                    selected ? 'text-white' : 'text-foreground',
                  )}
                >
                  {preset.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text className='mb-2 text-[12px] font-medium uppercase tracking-wide text-foreground/60'>
          Custom range
        </Text>

        <DateField
          label='Start date'
          value={draft.start}
          isActive={pickerTarget === 'start'}
          onPress={() => setPickerTarget(prev => (prev === 'start' ? null : 'start'))}
        />
        <DateField
          label='End date'
          value={draft.end}
          isActive={pickerTarget === 'end'}
          onPress={() => setPickerTarget(prev => (prev === 'end' ? null : 'end'))}
        />

        {pickerTarget ? (
          <View className='mt-2 overflow-hidden rounded-2xl bg-card'>
            <DateTimePicker
              value={pickerValue}
              mode='date'
              display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
              maximumDate={maximumDate}
              {...(pickerTarget === 'end' && draft.start !== undefined
                ? { minimumDate: new Date(draft.start) }
                : {})}
              onChange={handlePickerChange}
              {...(brand ? { accentColor: brand } : {})}
            />
            {Platform.OS === 'ios' ? (
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Done selecting date'
                onPress={() => setPickerTarget(null)}
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
      </View>

      <KeyboardStickyView
        offset={{ closed: 0, opened: insets.bottom - 2 }}
        style={styles.stickyFooter}
      >
        <View
          style={{ paddingBottom: footerBottomPad }}
          className='flex-row gap-3 bg-neutral-100 px-4 pt-2 dark:bg-tabs-screen'
        >
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Clear date filter'
            disabled={!canClear}
            onPress={handleClear}
            className={cn(
              'flex-1 items-center justify-center rounded-full border border-foreground/20 py-3 active:opacity-70',
              !canClear && 'opacity-40',
            )}
          >
            <Text className='text-[15px] font-medium text-foreground'>Clear</Text>
          </Pressable>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Save date filter'
            onPress={handleSave}
            className='flex-1 items-center justify-center rounded-full py-3 active:opacity-80'
            style={{ backgroundColor: saveBg }}
          >
            <Text className='text-[15px] font-medium' style={{ color: saveFg }}>
              Save
            </Text>
          </Pressable>
        </View>
      </KeyboardStickyView>
    </Animated.View>
  );
});

const DateField = memo(function DateField({
  label,
  value,
  isActive,
  onPress,
}: {
  label: string;
  value: number | undefined;
  isActive: boolean;
  onPress: () => void;
}) {
  const foreground = useCSSVariable('--color-foreground') as string;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={onPress}
      className={cn(
        'mb-3 flex-row items-center gap-3 rounded-xl border px-3.5 py-3.5 active:opacity-70',
        isActive ? 'border-blue-500 bg-blue-500/10' : 'border-foreground/15 bg-card',
      )}
    >
      <Calendar size={18} color={foreground} strokeWidth={2} />
      <View className='min-w-0 flex-1'>
        <Text className='text-[12px] font-medium text-foreground/50'>{label}</Text>
        <Text className='mt-0.5 text-[16px] text-foreground'>
          {value !== undefined ? formatShortFilterDate(value) : 'Select date'}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  stickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
