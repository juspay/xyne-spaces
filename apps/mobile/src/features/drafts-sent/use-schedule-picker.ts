import { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { haptics } from '@/src/utils/haptics';

import { defaultCustomScheduleTime, validateScheduledFor } from './schedule-message-utils';

export type SchedulePickerMode = 'date' | 'time' | null;
export type ScheduleView = 'presets' | 'custom' | 'confirm';

type UseSchedulePickerOptions = {
  isOpen: boolean;
  initialScheduledFor?: number | undefined;
  onConfirm: (scheduledFor: number) => Promise<void> | void;
  /** After a successful confirm: put the picker away. */
  onDone: () => void;
};

export type SchedulePicker = {
  view: ScheduleView;
  customDateTime: Date;
  pendingScheduledFor: number | null;
  pickerMode: SchedulePickerMode;
  isSubmitting: boolean;
  /** The native picker's value: the custom time, or the default once that has passed. */
  pickerValue: Date;
  goToConfirm: (scheduledFor: number) => void;
  submit: () => Promise<void>;
  openCustom: () => void;
  backToPresets: () => void;
  togglePicker: (next: Exclude<SchedulePickerMode, null>) => void;
  closePicker: () => void;
  handlePickerChange: (event: DateTimePickerEvent, selectedDate?: Date) => void;
};

/**
 * The schedule picker's steps and state (presets, custom date and time,
 * confirm), shared by the classic sheet and the conversation's tray so both
 * validate, confirm and fail the same way.
 */
export function useSchedulePicker({
  isOpen,
  initialScheduledFor,
  onConfirm,
  onDone,
}: UseSchedulePickerOptions): SchedulePicker {
  const [view, setView] = useState<ScheduleView>('presets');
  const [customDateTime, setCustomDateTime] = useState<Date>(() => defaultCustomScheduleTime());
  const [pendingScheduledFor, setPendingScheduledFor] = useState<number | null>(null);
  const [pickerMode, setPickerMode] = useState<SchedulePickerMode>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setView('presets');
      setPickerMode(null);
      setPendingScheduledFor(null);
      setIsSubmitting(false);
      return;
    }
    const initial =
      typeof initialScheduledFor === 'number' && initialScheduledFor > Date.now()
        ? new Date(initialScheduledFor)
        : defaultCustomScheduleTime();
    setCustomDateTime(initial);
  }, [initialScheduledFor, isOpen]);

  const goToConfirm = useCallback((scheduledFor: number): void => {
    const error = validateScheduledFor(scheduledFor);
    if (error) {
      Alert.alert('Pick a future time', error);
      return;
    }
    setPickerMode(null);
    setPendingScheduledFor(scheduledFor);
    setView('confirm');
  }, []);

  const submit = useCallback(async (): Promise<void> => {
    if (pendingScheduledFor === null) return;
    const error = validateScheduledFor(pendingScheduledFor);
    if (error) {
      Alert.alert('Pick a future time', error);
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm(pendingScheduledFor);
      void haptics.success();
      onDone();
    } catch (caught) {
      Alert.alert(
        'Could not schedule',
        caught instanceof Error ? caught.message : 'Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, onConfirm, onDone, pendingScheduledFor]);

  const openCustom = useCallback((): void => {
    setPickerMode(null);
    setView('custom');
  }, []);

  const backToPresets = useCallback((): void => setView('presets'), []);

  const togglePicker = useCallback((next: Exclude<SchedulePickerMode, null>): void => {
    setPickerMode(current => (current === next ? null : next));
  }, []);

  const closePicker = useCallback((): void => setPickerMode(null), []);

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date): void => {
      if (Platform.OS === 'android') setPickerMode(null);
      if (event.type === 'dismissed' || !selectedDate) return;
      setCustomDateTime(current => {
        const next = new Date(current);
        if (pickerMode === 'date') {
          next.setFullYear(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            selectedDate.getDate(),
          );
        } else {
          next.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
        }
        return next;
      });
    },
    [pickerMode],
  );

  const pickerValue = customDateTime > new Date() ? customDateTime : defaultCustomScheduleTime();

  return {
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
  };
}
