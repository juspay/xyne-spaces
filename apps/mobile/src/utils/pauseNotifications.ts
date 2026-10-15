/**
 * Global notification pause. Preset durations match dashboard (`now + minutes`),
 * not availability's end-of-day / end-of-week helpers.
 * Kept free of react-native imports so it stays unit-testable under tests/unit.
 */

export type PauseOptionId =
  '30min' | '1hour' | '2hours' | '4hours' | 'tomorrow' | 'nextWeek' | 'custom';

export const PAUSE_NOTIFICATION_OPTIONS: readonly {
  id: PauseOptionId;
  label: string;
  minutes: number | null;
}[] = [
  { id: '30min', label: '30 minutes', minutes: 30 },
  { id: '1hour', label: '1 hour', minutes: 60 },
  { id: '2hours', label: '2 hours', minutes: 120 },
  { id: '4hours', label: '4 hours', minutes: 240 },
  { id: 'tomorrow', label: 'Until tomorrow', minutes: 1440 },
  { id: 'nextWeek', label: 'Until next week', minutes: 10080 },
  { id: 'custom', label: 'Custom', minutes: null },
];

export type PauseFields = {
  notificationsPausedUntil?: number | null;
  presenceStatus?: {
    notificationsPausedUntil?: number | null;
  } | null;
};

export const isPauseActive = (
  until: number | null | undefined,
  now = Date.now(),
): until is number => typeof until === 'number' && until > now;

export const resolveNotificationsPausedUntil = (
  ...values: Array<number | null | undefined>
): number | undefined => values.find(value => isPauseActive(value));

export const canSavePauseSelection = (
  option: PauseOptionId | null,
  customDateTime: Date,
  now = Date.now(),
): boolean => {
  if (option === null) return false;
  return resolvePauseUntil(option, customDateTime) > now;
};

export const collectPauseUntilCandidates = (
  ...rows: Array<PauseFields | null | undefined>
): Array<number | null | undefined> => {
  return rows.flatMap(row => [
    row?.notificationsPausedUntil,
    row?.presenceStatus?.notificationsPausedUntil,
  ]);
};

export const initialCustomPauseTime = (): Date => {
  const date = new Date();
  date.setSeconds(0, 0);
  const remainder = date.getMinutes() % 5;
  date.setMinutes(date.getMinutes() + (remainder === 0 ? 5 : 5 - remainder));
  if (date.getTime() <= Date.now()) {
    date.setMinutes(date.getMinutes() + 5);
  }

  return date;
};

export const resolvePauseUntil = (option: PauseOptionId, customDateTime: Date): number => {
  const preset = PAUSE_NOTIFICATION_OPTIONS.find(item => item.id === option);
  if (!preset || preset.minutes === null) {
    return customDateTime.getTime();
  }

  return Date.now() + preset.minutes * 60 * 1000;
};

export const isSameLocalDay = (left: Date, right: Date): boolean => {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
};

export const formatPauseDate = (value: Date, now = new Date()): string => {
  if (isSameLocalDay(value, now)) return 'Today';
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameLocalDay(value, tomorrow)) return 'Tomorrow';
  return value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const formatPauseTime = (value: Date): string =>
  value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const ordinalDay = (day: number): string => {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
};

/** Custom pause summary, e.g. "October 28th at 12:28 PM". */
export const formatPauseCustomSummary = (value: Date): string => {
  const month = value.toLocaleDateString('en-US', { month: 'long' });
  const time = value
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(/\u202f/g, ' ');
  return `${month} ${ordinalDay(value.getDate())} at ${time}`;
};

export const formatPauseUntilLabel = (until: number): string => {
  const date = new Date(until);
  return `Until ${date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
};
