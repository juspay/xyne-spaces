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
    // A 5th weekday exists only some months; "last" (BYDAY=-1) is what the rule means by it.
    ordinalWord: occurrence === 5 ? 'last' : ORDINAL_WORDS[occurrence - 1] || `${occurrence}th`,
  };
};
