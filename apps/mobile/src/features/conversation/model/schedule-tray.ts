import {
  SCHEDULE_PRESETS,
  type SchedulePresetId,
} from '@/src/features/drafts-sent/schedule-message-utils';

import { SCHEDULE_TRAY_CUSTOM_LEAD_MINUTES, SCHEDULE_TRAY_CUSTOM_STEP_MINUTES } from '../constants';
import type { TrayRow } from './tray-card';
import { clockLabel } from './message-time';
import { scheduleDateLabel, scheduleWhenLabel } from './schedule-time';

export type ScheduleTrayChoiceId = SchedulePresetId | 'custom';

/** A choice row; a preset carries the time it schedules for, "Custom…" none. */
export type ScheduleTrayChoice = TrayRow<ScheduleTrayChoiceId> &
  Readonly<{ scheduledFor: number | null }>;

/** The classic presets, named for the day; their exact time goes underneath. */
function presetTitle(id: SchedulePresetId): string {
  switch (id) {
    case 'tomorrow-9am':
      return 'Tomorrow';
    case 'next-monday-9am':
      return 'Next Monday';
  }
}

/**
 * The schedule tray's first step: the classic sheet's presets at the times it
 * would pick from `now`, then "Custom…" for the date and time pickers.
 */
export function scheduleTrayChoices(now: Date): readonly ScheduleTrayChoice[] {
  return [
    ...SCHEDULE_PRESETS.map(preset => {
      const scheduledFor = preset.getTime(now);
      return {
        id: preset.id,
        title: presetTitle(preset.id),
        subtitle: scheduleWhenLabel(new Date(scheduledFor)),
        disabled: false,
        scheduledFor,
      };
    }),
    {
      id: 'custom',
      title: 'Custom…',
      subtitle: 'Pick a date and time',
      disabled: false,
      scheduledFor: null,
    },
  ];
}

export type ScheduleTrayFieldId = 'date' | 'time';

/** The custom step's two rows, each opening its picker, with the value chosen so far. */
export function scheduleTrayFields(value: Date): readonly TrayRow<ScheduleTrayFieldId>[] {
  return [
    { id: 'date', title: 'Date', subtitle: scheduleDateLabel(value), disabled: false },
    { id: 'time', title: 'Time', subtitle: clockLabel(value), disabled: false },
  ];
}

const MINUTE_MS = 60_000;

/** The custom step's first value: the next whole step at least the lead time after `now`. */
export function scheduleTrayCustomStart(now: Date): Date {
  const step = SCHEDULE_TRAY_CUSTOM_STEP_MINUTES * MINUTE_MS;
  const earliest = now.getTime() + SCHEDULE_TRAY_CUSTOM_LEAD_MINUTES * MINUTE_MS;
  return new Date(Math.ceil(earliest / step) * step);
}
