/**
 * Shared helpers for "pick a preset duration, or a custom date and time" flows.
 *
 * Used by the availability screen, the message reminder sheet and the status sheet.
 * Kept free of react-native imports so it stays unit-testable under tests/unit.
 */

export type TimeSelectionOptionId = '30min' | '1hour' | '4hours' | 'today' | 'week' | 'custom';
export type PickerMode = 'date' | 'time' | null;

export const endOfToday = (): Date => {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
};

export const endOfWeek = (): Date => {
  const date = new Date();
  const daysUntilSunday = (7 - date.getDay()) % 7;
  date.setDate(date.getDate() + daysUntilSunday);
  date.setHours(23, 59, 59, 999);
  return date;
};

export const initialCustomTime = (): Date => {
  const date = endOfToday();
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
};

export const resolveTimeSelection = (
  option: TimeSelectionOptionId,
  customDateTime: Date,
): number => {
  const now = Date.now();
  switch (option) {
    case '30min':
      return now + 30 * 60 * 1000;
    case '1hour':
      return now + 60 * 60 * 1000;
    case '4hours':
      return now + 4 * 60 * 60 * 1000;
    case 'today':
      return endOfToday().getTime();
    case 'week':
      return endOfWeek().getTime();
    case 'custom':
      return customDateTime.getTime();
  }
};

export const mergeDatePart = (current: Date, selected: Date): Date => {
  const next = new Date(current);
  next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  return next;
};

export const mergeTimePart = (current: Date, selected: Date): Date => {
  const next = new Date(current);
  next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  return next;
};

export const formatDateTime = (value: number | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const formatDate = (value: Date): string =>
  value.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
  });

export const formatTime = (value: Date): string =>
  value.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
