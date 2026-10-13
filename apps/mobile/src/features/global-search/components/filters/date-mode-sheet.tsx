import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';
import { useMountWhileOpen } from '../../hooks/use-mount-while-open';
import { DATE_MODES, type DateMode } from '../../utils/filter-model';
import { FilterSheetHeader } from './filter-sheet-header';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fixed height — nested `dynamic` sheets with short content can measure to ~0 and leave a stuck touch-blocker. */
const DATE_SHEET_SNAP_POINTS = ['50%'];

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromIso(value: string): Date {
  if (!ISO_DATE.test(value)) return new Date();
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

type DateModeSheetProps = {
  mode: DateMode | null;
  initial: { after: string; before: string };
  onCancel: () => void;
  onSave: (next: { after: string; before: string }) => void;
};

export function DateModeSheet({
  mode,
  initial,
  onCancel,
  onSave,
}: DateModeSheetProps): ReactElement | null {
  const isOpen = mode !== null;
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onCancel);
  if (!shouldRender || !mode) return null;

  return (
    <DateModeSheetBody
      {...sheetProps}
      mode={mode}
      initial={initial}
      onCancel={onCancel}
      onSave={onSave}
    />
  );
}

function DateModeSheetBody({
  isOpen,
  onOpenChange,
  onDismiss,
  mode,
  initial,
  onCancel,
  onSave,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  mode: DateMode;
  initial: { after: string; before: string };
  onCancel: () => void;
  onSave: (next: { after: string; before: string }) => void;
}): ReactElement {
  const isRange = mode === '__range__';
  const [start, setStart] = useState(
    mode === '__before__' ? initial.before || toIso(new Date()) : initial.after || toIso(new Date()),
  );
  const [end, setEnd] = useState(initial.before || toIso(new Date()));
  const [editing, setEditing] = useState<'start' | 'end'>('start');
  // Android: mount the native dialog only while picking. Start open so choosing
  // On/Before/After/Range immediately shows the picker; dismiss in onChange so
  // value updates do not re-open it (tickets-date-filter pattern).
  const [androidPickerOpen, setAndroidPickerOpen] = useState(Platform.OS === 'android');
  const { accentText } = useBubbleAccent();
  const muted = useCSSVariable('--color-bottomsheet-text-muted') as string;

  const title = DATE_MODES.find(item => item.value === mode)?.label ?? 'Date';
  const startDate = useMemo(() => fromIso(start), [start]);
  const endDate = useMemo(() => fromIso(end), [end]);

  const canSave = isRange ? Boolean(start && end) : Boolean(start);

  const commit = useCallback(() => {
    if (!canSave) return;
    void haptics.buttonTap();
    if (isRange) onSave({ after: start, before: end });
    else if (mode === '__on__') onSave({ after: start, before: start });
    else if (mode === '__after__') onSave({ after: start, before: '' });
    else onSave({ after: '', before: start });
  }, [canSave, end, isRange, mode, onSave, start]);

  const onPickerChange = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      if (Platform.OS === 'android') {
        setAndroidPickerOpen(false);
        if (event.type !== 'set' || !date) return;
      }
      if (!date) return;
      const iso = toIso(date);
      if (editing === 'end') setEnd(iso);
      else setStart(iso);
    },
    [editing],
  );

  const openAndroidPicker = useCallback((field: 'start' | 'end') => {
    setEditing(field);
    if (Platform.OS === 'android') setAndroidPickerOpen(true);
  }, []);

  const showPicker = Platform.OS === 'ios' || androidPickerOpen;

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      mode='snap'
      snapPoints={DATE_SHEET_SNAP_POINTS}
      backdropOpacity={0.4}
    >
      <FilterSheetHeader
        title={title}
        onCancel={() => {
          void haptics.buttonTap();
          onCancel();
        }}
        {...(canSave ? { onApply: commit } : {})}
      />
      <View className='gap-3 px-4 pb-6 pt-2'>
        <Pressable
          onPress={() => openAndroidPicker('start')}
          className='rounded-xl border border-border px-3 py-3'
          style={editing === 'start' ? { borderColor: accentText } : undefined}
        >
          <Text className='text-[12px]' style={{ color: muted }}>
            {mode === '__before__' ? 'Before' : isRange ? 'From' : 'Date'}
          </Text>
          <Text className='mt-0.5 text-[16px] text-foreground'>{start}</Text>
        </Pressable>
        {isRange ? (
          <Pressable
            onPress={() => openAndroidPicker('end')}
            className='rounded-xl border border-border px-3 py-3'
            style={editing === 'end' ? { borderColor: accentText } : undefined}
          >
            <Text className='text-[12px]' style={{ color: muted }}>
              To
            </Text>
            <Text className='mt-0.5 text-[16px] text-foreground'>{end}</Text>
          </Pressable>
        ) : null}
        {showPicker ? (
          <DateTimePicker
            value={editing === 'end' ? endDate : startDate}
            mode='date'
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={onPickerChange}
          />
        ) : null}
      </View>
    </AppBottomSheet>
  );
}
