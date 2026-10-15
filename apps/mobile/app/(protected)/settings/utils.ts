import { resolveTimeSelection, type TimeSelectionOptionId } from '@/src/utils/timeSelection';

export type { PickerMode } from '@/src/utils/timeSelection';
export {
  endOfToday,
  endOfWeek,
  formatDate,
  formatDateTime,
  formatTime,
  initialCustomTime,
  mergeDatePart,
  mergeTimePart,
} from '@/src/utils/timeSelection';

export type PauseOptionId = TimeSelectionOptionId;
export const pauseUntilForOption = resolveTimeSelection;

export const PAUSE_OPTIONS: readonly {
  id: PauseOptionId;
  label: string;
  description: string;
}[] = [
  { id: '30min', label: '30 minutes', description: 'Pause short assignment handoffs.' },
  { id: '1hour', label: '1 hour', description: 'Step away for a quick break.' },
  { id: '4hours', label: '4 hours', description: 'Pause for part of the day.' },
  { id: 'today', label: 'Today', description: 'Resume at the end of today.' },
  { id: 'week', label: 'This week', description: 'Resume at the end of this week.' },
  { id: 'custom', label: 'Custom', description: 'Choose a return date and time.' },
];

export const resolveAssignmentUnavailableUntil = (
  ...values: Array<number | null | undefined>
): number | undefined => {
  const now = Date.now();
  return values.find((value): value is number => typeof value === 'number' && value > now);
};
