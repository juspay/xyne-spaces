import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { Calendar, Clock } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

import { clampPickerSelection, startOfDraft } from './date-picker-draft';
import { TicketMetaPickerSheet } from './ticket-meta-picker-sheet';

export type DatePickerMode = 'date' | 'time' | 'datetime';

type DatePickerSheetProps = {
  isOpen: boolean;
  title?: string;
  /** Current value as epoch ms, or null when unset. */
  value: number | null;
  onClose: () => void;
  /**
   * Confirmed value in epoch ms.
   * When `allowClear` is true, `null` clears — only use if the write API supports it.
   */
  onSelect: (valueMs: number | null) => void;
  mode?: DatePickerMode;
  /** Default false — Zero `ticket.update` does not support clearing `eta`. */
  allowClear?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
};

type AndroidPickerTarget = 'date' | 'time' | null;

function mergeDatePart(draft: Date, selected: Date): Date {
  const next = new Date(draft);
  next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  return next;
}

function mergeTimePart(draft: Date, selected: Date): Date {
  const next = new Date(draft);
  next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  return next;
}

function formatPreview(draft: Date, mode: DatePickerMode): string {
  if (mode === 'time') return format(draft, 'h:mm a');
  if (mode === 'datetime') return format(draft, 'd MMM, h:mm a');
  return format(draft, 'd MMM, yyyy');
}

/**
 * Reusable date / time picker sheet for ticket meta (and similar) fields.
 * Confirms via Save. Optional Clear only when the write path supports null.
 */
export function DatePickerSheet({
  isOpen,
  title = 'Date',
  value,
  onClose,
  onSelect,
  mode = 'date',
  allowClear = false,
  minimumDate,
  maximumDate,
}: DatePickerSheetProps): ReactElement {
  const { accentBg, accentFg } = useBubbleAccent();
  const brand = useCSSVariable('--color-brand') as string;
  const foreground = useCSSVariable('--color-foreground') as string;
  const [draft, setDraft] = useState(() => startOfDraft(value, minimumDate));
  const [androidTarget, setAndroidTarget] = useState<AndroidPickerTarget>(null);

  useEffect(() => {
    if (!isOpen) {
      setAndroidTarget(null);
      return;
    }
    // Preserve overdue values while editing; Save still rejects past via decideDateUpdate.
    setDraft(startOfDraft(value, minimumDate));
  }, [isOpen, minimumDate, value]);

  const applySelection = useCallback(
    (next: Date): Date =>
      clampPickerSelection(next, {
        value,
        ...(minimumDate ? { minimumDate } : {}),
      }),
    [minimumDate, value],
  );

  const handleIosDateChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (event.type === 'dismissed' || !selectedDate) return;
      setDraft(current => applySelection(mergeDatePart(current, selectedDate)));
    },
    [applySelection],
  );

  const handleIosTimeChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (event.type === 'dismissed' || !selectedDate) return;
      setDraft(current => applySelection(mergeTimePart(current, selectedDate)));
    },
    [applySelection],
  );

  const handleIosDatetimeChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (event.type === 'dismissed' || !selectedDate) return;
      setDraft(applySelection(selectedDate));
    },
    [applySelection],
  );

  const handleAndroidChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      const target = androidTarget;
      setAndroidTarget(null);
      if (event.type === 'dismissed' || !selectedDate || !target) return;
      setDraft(current =>
        applySelection(
          target === 'time'
            ? mergeTimePart(current, selectedDate)
            : mergeDatePart(current, selectedDate),
        ),
      );
    },
    [androidTarget, applySelection],
  );

  const handleSave = useCallback(
    (dismiss: () => void) => {
      void haptics.selection();
      onSelect(draft.getTime());
      dismiss();
    },
    [draft, onSelect],
  );

  const handleClear = useCallback(
    (dismiss: () => void) => {
      void haptics.selection();
      onSelect(null);
      dismiss();
    },
    [onSelect],
  );

  const canClear = allowClear && value !== null;
  const useIosCombinedDatetime = Platform.OS === 'ios' && mode === 'datetime';

  return (
    <TicketMetaPickerSheet isOpen={isOpen} title={title} onClose={onClose}>
      {({ dismiss }) => (
        <View className='min-h-0 flex-1 px-5'>
          <View className='mb-4 rounded-xl border border-foreground/15 bg-card px-3.5 py-3.5'>
            <Text className='text-[12px] font-medium text-foreground/50'>Selected</Text>
            <Text className='mt-0.5 text-[16px] font-medium text-foreground'>
              {formatPreview(draft, mode)}
            </Text>
          </View>

          {Platform.OS === 'ios' ? (
            useIosCombinedDatetime ? (
              <View className='overflow-hidden rounded-2xl bg-card'>
                <DateTimePicker
                  value={draft}
                  mode='datetime'
                  display='spinner'
                  onChange={handleIosDatetimeChange}
                  {...(minimumDate ? { minimumDate } : {})}
                  {...(maximumDate ? { maximumDate } : {})}
                  {...(brand ? { accentColor: brand } : {})}
                />
              </View>
            ) : (
              <View className='gap-3'>
                {mode === 'date' ? (
                  <View className='overflow-hidden rounded-2xl bg-card'>
                    <DateTimePicker
                      value={draft}
                      mode='date'
                      display='inline'
                      onChange={handleIosDateChange}
                      {...(minimumDate ? { minimumDate } : {})}
                      {...(maximumDate ? { maximumDate } : {})}
                      {...(brand ? { accentColor: brand } : {})}
                    />
                  </View>
                ) : null}
                {mode === 'time' ? (
                  <View className='overflow-hidden rounded-2xl bg-card'>
                    <DateTimePicker
                      value={draft}
                      mode='time'
                      display='spinner'
                      onChange={handleIosTimeChange}
                      {...(brand ? { accentColor: brand } : {})}
                    />
                  </View>
                ) : null}
              </View>
            )
          ) : (
            <View className='gap-3'>
              {mode !== 'time' ? (
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel='Choose date'
                  onPress={() => setAndroidTarget('date')}
                  className={cn(
                    'flex-row items-center gap-3 rounded-xl border px-3.5 py-3.5 active:opacity-70',
                    androidTarget === 'date'
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-foreground/15 bg-card',
                  )}
                >
                  <Calendar size={18} color={foreground} />
                  <View className='min-w-0 flex-1'>
                    <Text className='text-[12px] font-medium text-foreground/50'>Date</Text>
                    <Text className='mt-0.5 text-[16px] text-foreground'>
                      {format(draft, 'd MMM, yyyy')}
                    </Text>
                  </View>
                </Pressable>
              ) : null}
              {mode === 'time' || mode === 'datetime' ? (
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel='Choose time'
                  onPress={() => setAndroidTarget('time')}
                  className={cn(
                    'flex-row items-center gap-3 rounded-xl border px-3.5 py-3.5 active:opacity-70',
                    androidTarget === 'time'
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-foreground/15 bg-card',
                  )}
                >
                  <Clock size={18} color={foreground} />
                  <View className='min-w-0 flex-1'>
                    <Text className='text-[12px] font-medium text-foreground/50'>Time</Text>
                    <Text className='mt-0.5 text-[16px] text-foreground'>
                      {format(draft, 'h:mm a')}
                    </Text>
                  </View>
                </Pressable>
              ) : null}
              {androidTarget ? (
                <DateTimePicker
                  value={draft}
                  mode={androidTarget}
                  display='default'
                  onChange={handleAndroidChange}
                  {...(androidTarget === 'date' && minimumDate ? { minimumDate } : {})}
                  {...(androidTarget === 'date' && maximumDate ? { maximumDate } : {})}
                  {...(brand ? { accentColor: brand } : {})}
                />
              ) : null}
            </View>
          )}

          <View className='mt-auto flex-row gap-3 pb-2 pt-4'>
            {allowClear ? (
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={`Clear ${title.toLowerCase()}`}
                disabled={!canClear}
                onPress={() => handleClear(dismiss)}
                className={cn(
                  'flex-1 items-center justify-center rounded-full border border-foreground/20 py-3.5 active:opacity-70',
                  !canClear && 'opacity-40',
                )}
              >
                <Text className='text-[15px] font-medium text-foreground'>Clear</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={`Save ${title.toLowerCase()}`}
              onPress={() => handleSave(dismiss)}
              className='flex-1 items-center justify-center rounded-full py-3.5 active:opacity-80'
              style={{ backgroundColor: accentBg }}
            >
              <Text className='text-[15px] font-semibold' style={{ color: accentFg }}>
                Save
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </TicketMetaPickerSheet>
  );
}
