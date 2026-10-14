export type ReminderPreset = {
  id: string;
  label: string;
  getTime: () => number;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const CUSTOM_REMINDER_DEFAULT_DELAY_MS = HOUR_MS;

const nextTimeAt = (hour: number, minute: number, dayOffset: number): number => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
};

export const REMINDER_PRESETS: readonly ReminderPreset[] = [
  // { id: '30s', label: 'In 30 seconds', getTime: () => Date.now() + 30 * 1000 },
  { id: '20m', label: 'In 20 minutes', getTime: () => Date.now() + 20 * MINUTE_MS },
  { id: '1h', label: 'In 1 hour', getTime: () => Date.now() + HOUR_MS },
  { id: 'tomorrow', label: 'Tomorrow morning', getTime: () => nextTimeAt(9, 0, 1) },
  { id: 'next-week', label: 'Next week', getTime: () => Date.now() + 7 * DAY_MS },
];
