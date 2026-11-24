import DateTimePicker from '@react-native-community/datetimepicker';
import { CalendarDays, Clock } from 'lucide-react-native';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactElement,
} from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import { useCSSVariable, useUniwind } from 'uniwind';

import type { ScheduleMessageSheetProps } from '@/src/features/drafts-sent/schedule-message-sheet';
import {
  useSchedulePicker,
  type SchedulePicker,
} from '@/src/features/drafts-sent/use-schedule-picker';

import {
  PLUS_TRAY_SECTION_GAP,
  SCHEDULE_TRAY_ACTIONS_GAP,
  SCHEDULE_TRAY_STEP_MS,
  SCHEDULE_TRAY_STEP_SCALE,
  SCHEDULE_TRAY_SUMMARY_PADDING_X,
  SCHEDULE_TRAY_SUMMARY_PADDING_Y,
} from '../constants';
import { fadeScaleTransition } from '../model/fade-scale-transition';
import {
  scheduleTrayChoices,
  scheduleTrayCustomStart,
  scheduleTrayFields,
  type ScheduleTrayChoiceId,
} from '../model/schedule-tray';
import { scheduleConfirmLabel } from '../model/schedule-time';
import { colorOf } from '../model/token-color';
import { TrayRowButton } from './tray-row';
import { TrayActionButton } from './tray-action-button';
import { TrayCard, TrayCardSection, useTrayCardMotion } from './tray-card';

const STEP = fadeScaleTransition({
  enterMs: SCHEDULE_TRAY_STEP_MS,
  exitMs: SCHEDULE_TRAY_STEP_MS,
  scale: SCHEDULE_TRAY_STEP_SCALE,
});

type RowColors = Readonly<{ iconColor: string; lowestColor: string }>;

/**
 * The room's schedule picker (Figma draws none): the classic sheet's steps
 * and state in the "+" tray's card. Its props are the sheet's, so the shared
 * schedule host can draw it in the sheet's place.
 */
export function ScheduleTray(props: ScheduleMessageSheetProps): ReactElement | null {
  return props.isOpen ? <ScheduleTrayCard {...props} /> : null;
}

/**
 * Only the composer's schedule host draws this, and it only ever schedules a
 * new message, so the sheet's reschedule mode and start time go unused.
 */
function ScheduleTrayCard({ onOpenChange, onConfirm }: ScheduleMessageSheetProps): ReactElement {
  const motion = useTrayCardMotion();
  // The card slides away before the host forgets it, on dismiss and after scheduling alike.
  const close = useCallback(
    (): void => void motion.hide().then(() => onOpenChange(false)),
    [motion, onOpenChange],
  );
  // A custom time starts a quarter hour or so out, so Continue is never in the past.
  const [startAt] = useState(() => scheduleTrayCustomStart(new Date()).getTime());
  const picker = useSchedulePicker({
    isOpen: true,
    initialScheduledFor: startAt,
    onConfirm,
    onDone: close,
  });
  const [foregroundToken, subtleToken] = useCSSVariable([
    '--color-spaces-foreground',
    '--color-spaces-subtle',
  ]);
  const colors: RowColors = {
    iconColor: colorOf(foregroundToken),
    lowestColor: colorOf(subtleToken),
  };
  return (
    <TrayCard
      motion={motion}
      title='Schedule message'
      // The iOS spinner turns on vertical drags, so the card holds still while it shows.
      dragToClose={picker.pickerMode === null}
      onDismiss={close}
    >
      {/* The first step arrives with the card; later swaps fade and grow in. */}
      <LayoutAnimationConfig skipEntering>
        <Animated.View key={picker.view} entering={STEP.entering} style={styles.step}>
          {picker.view === 'presets' ? <ChoicesStep picker={picker} colors={colors} /> : null}
          {picker.view === 'custom' ? <CustomStep picker={picker} colors={colors} /> : null}
          {picker.view === 'confirm' && picker.pendingScheduledFor !== null ? (
            <ConfirmStep
              picker={picker}
              scheduledFor={picker.pendingScheduledFor}
              isHiding={motion.isHiding}
            />
          ) : null}
        </Animated.View>
      </LayoutAnimationConfig>
    </TrayCard>
  );
}

type StepProps = { picker: SchedulePicker; colors: RowColors };

/** Tomorrow, next Monday (each with its exact time) or a custom date and time. */
function ChoicesStep({ picker, colors }: StepProps): ReactElement {
  const { goToConfirm, openCustom } = picker;
  const choose = useCallback(
    (id: ScheduleTrayChoiceId): void => {
      if (id === 'custom') {
        openCustom();
        return;
      }
      // Timed at the tap, as the sheet's presets are.
      const scheduledFor = scheduleTrayChoices(new Date()).find(row => row.id === id)?.scheduledFor;
      if (typeof scheduledFor === 'number') goToConfirm(scheduledFor);
    },
    [goToConfirm, openCustom],
  );

  return (
    <TrayCardSection last>
      {scheduleTrayChoices(new Date()).map(row => (
        <TrayRowButton
          key={row.id}
          row={row}
          icon={row.id === 'custom' ? CalendarDays : Clock}
          iconColor={colors.iconColor}
          lowestColor={colors.lowestColor}
          onPress={choose}
        />
      ))}
    </TrayCardSection>
  );
}

/**
 * The date and time rows, each opening the classic sheet's native picker
 * (inline spinner on iOS, the system dialog on Android), then Continue.
 */
function CustomStep({ picker, colors }: StepProps): ReactElement {
  const { theme } = useUniwind();
  const { togglePicker, goToConfirm, customDateTime } = picker;
  const proceed = useCallback(
    (): void => goToConfirm(customDateTime.getTime()),
    [customDateTime, goToConfirm],
  );

  return (
    <>
      <TrayCardSection last={false}>
        {scheduleTrayFields(customDateTime).map(row => (
          <TrayRowButton
            key={row.id}
            row={row}
            icon={row.id === 'date' ? CalendarDays : Clock}
            iconColor={colors.iconColor}
            lowestColor={colors.lowestColor}
            onPress={togglePicker}
          />
        ))}
        {picker.pickerMode === null ? null : (
          <>
            <DateTimePicker
              value={picker.pickerValue}
              mode={picker.pickerMode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant={theme === 'dark' ? 'dark' : 'light'}
              {...(picker.pickerMode === 'date' ? { minimumDate: new Date() } : {})}
              onChange={picker.handlePickerChange}
            />
            {Platform.OS === 'ios' ? (
              <TrayActionButton label='Done' tone='quiet' onPress={picker.closePicker} />
            ) : null}
          </>
        )}
      </TrayCardSection>
      <View style={styles.actions}>
        <TrayActionButton label='Continue' tone='primary' onPress={proceed} />
        <TrayActionButton label='Back' tone='quiet' onPress={picker.backToPresets} />
      </View>
    </>
  );
}

type ConfirmStepProps = {
  picker: SchedulePicker;
  scheduledFor: number;
  isHiding: () => boolean;
};

/** When it sends, Schedule and Back; screen readers land on the line first. */
function ConfirmStep({ picker, scheduledFor, isHiding }: ConfirmStepProps): ReactElement {
  const summaryRef = useRef<ComponentRef<typeof Text>>(null);
  const { submit } = picker;
  // Once scheduled the button wakes again while the card slides away; a second tap there is ignored.
  const schedule = useCallback((): void => {
    if (!isHiding()) void submit();
  }, [isHiding, submit]);

  useEffect(() => {
    const node = summaryRef.current;
    if (node !== null) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  }, []);

  return (
    <>
      <TrayCardSection last={false}>
        <Text
          ref={summaryRef}
          className='text-[16px] leading-[22px] text-spaces-foreground'
          style={styles.summary}
        >
          {scheduleConfirmLabel(new Date(scheduledFor))}
        </Text>
      </TrayCardSection>
      <View style={styles.actions}>
        <TrayActionButton
          label='Schedule'
          tone='primary'
          disabled={picker.isSubmitting}
          onPress={schedule}
        />
        <TrayActionButton label='Back' tone='quiet' onPress={picker.backToPresets} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  step: { rowGap: PLUS_TRAY_SECTION_GAP },
  summary: {
    paddingHorizontal: SCHEDULE_TRAY_SUMMARY_PADDING_X,
    paddingVertical: SCHEDULE_TRAY_SUMMARY_PADDING_Y,
  },
  actions: { rowGap: SCHEDULE_TRAY_ACTIONS_GAP },
});
