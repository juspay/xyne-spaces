export const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth'];

export const getDefaultScheduledStartTime = (): Date => {
  const now = new Date();
  const minutes = now.getMinutes();
  const result = new Date(now);

  if (minutes < 30) {
    result.setMinutes(30, 0, 0);
  } else {
    result.setHours(result.getHours() + 1, 0, 0, 0);
  }

  const gapMinutes = (result.getTime() - now.getTime()) / (1000 * 60);
  if (gapMinutes < 25) {
    result.setMinutes(result.getMinutes() + 30);
  }

  return result;
};

export const toHHMM = (date: Date | null | undefined): string => {
  if (!date) return '00:00';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export const isValidDate = (date: unknown): date is Date =>
  date instanceof Date && !Number.isNaN(date.getTime());

export const applyHHMMToDate = (date: Date, hhmm: string): Date => {
  const [rawHours, rawMinutes] = hhmm.split(':');
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  const next = new Date(date);

  if (
    Number.isInteger(hours) &&
    Number.isInteger(minutes) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59
  ) {
    next.setHours(hours, minutes, 0, 0);
  }

  return next;
};

export const parseTimeAndUpdateDate = (
  timeString?: string,
  currentDate?: Date | null,
): Date | null => {
  if (!currentDate || !timeString) return currentDate ?? null;

  const newDate = new Date(currentDate);
  const timeParts = timeString.match(/(\d+):(\d+)\s*(AM|PM)/i);

  if (!timeParts) return newDate;

  let hours = parseInt(timeParts[1] || '12', 10);
  const minutes = parseInt(timeParts[2] || '00', 10);
  const meridiem = (timeParts[3] || 'AM').toUpperCase();

  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;

  newDate.setHours(hours, minutes, 0, 0);
  return newDate;
};

export const getWeekdayOccurrence = (
  date: Date,
): { occurrence: number; weekday: string; isLast: boolean; ordinalWord: string } => {
  if (!isValidDate(date)) {
    return { occurrence: 1, weekday: 'Monday', isLast: false, ordinalWord: 'first' };
  }

  const year = date.getFullYear();
  const month = date.getMonth();
  const dayOfMonth = date.getDate();
  const targetWeekday = date.getDay();

  let occurrence = 0;
  for (let d = 1; d <= dayOfMonth; d++) {
    const tempDate = new Date(year, month, d);
    if (tempDate.getDay() === targetWeekday) {
      occurrence++;
    }
  }

  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  let isLast = true;
  for (let d = dayOfMonth + 1; d <= lastDayOfMonth; d++) {
    const tempDate = new Date(year, month, d);
    if (tempDate.getDay() === targetWeekday) {
      isLast = false;
      break;
    }
  }

  const WEEKDAY_NAMES = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];

  return {
    occurrence,
    weekday: WEEKDAY_NAMES[targetWeekday] ?? 'Monday',
    isLast,
    ordinalWord: ORDINAL_WORDS[occurrence - 1] || `${occurrence}th`,
  };
};
