import type { MonthlyType, RecurrenceFrequency, SeriesEndsType } from './types';
import { getWeekdayOccurrence, ORDINAL_WORDS } from './dateTime';

export { ORDINAL_WORDS } from './dateTime';

export const DAY_OPTIONS: { key: string; label: string }[] = [
  { key: 'SU', label: 'S' },
  { key: 'MO', label: 'M' },
  { key: 'TU', label: 'T' },
  { key: 'WE', label: 'W' },
  { key: 'TH', label: 'T' },
  { key: 'FR', label: 'F' },
  { key: 'SA', label: 'S' },
];

export const DAY_KEYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const RRULE_FREQ: Record<RecurrenceFrequency, string> = {
  DAY: 'DAILY',
  WEEK: 'WEEKLY',
  MONTH: 'MONTHLY',
};

const FULL_DAY_NAME: Record<string, string> = {
  SU: 'Sunday',
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
};

const SHORT_DAY_NAME: Record<string, string> = {
  SU: 'Sun',
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
};

interface BuildRecurrenceRuleParams {
  recurrenceFrequency: RecurrenceFrequency;
  repeatValue: number | '';
  recurrenceDays: string[];
  monthlyType: MonthlyType;
  startsAt: Date;
  seriesEndsType: SeriesEndsType;
  occurrenceCount: number | '';
}

export function buildRecurrenceRule({
  recurrenceFrequency,
  repeatValue,
  recurrenceDays,
  monthlyType,
  startsAt,
  seriesEndsType,
  occurrenceCount,
}: BuildRecurrenceRuleParams): string {
  let rule = `FREQ=${RRULE_FREQ[recurrenceFrequency]}`;

  if (typeof repeatValue === 'number' && repeatValue > 1) {
    rule += `;INTERVAL=${repeatValue}`;
  }

  if (recurrenceFrequency === 'WEEK' && recurrenceDays.length > 0) {
    rule += `;BYDAY=${recurrenceDays.join(',')}`;
  }

  if (recurrenceFrequency === 'MONTH') {
    if (monthlyType === 'monthly_day') {
      rule += `;BYMONTHDAY=${startsAt.getDate()}`;
    } else if (monthlyType === 'monthly_nth_weekday') {
      const { occurrence, weekday } = getWeekdayOccurrence(startsAt);
      const weekdayCode = weekday.substring(0, 2).toUpperCase();
      rule += `;BYDAY=${occurrence}${weekdayCode}`;
    }
  }

  if (seriesEndsType === 'after') {
    rule += `;COUNT=${occurrenceCount}`;
  }

  return rule;
}

interface GetRecurrenceLabelParams {
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency;
  repeatValue: number | '';
  recurrenceDays: string[];
  monthlyType: MonthlyType;
  startsAt: Date;
  seriesEndsType: SeriesEndsType;
  seriesEndsOn: Date | null;
  occurrenceCount: number | '';
}

export function getRecurrenceLabel({
  isRecurring,
  recurrenceFrequency,
  repeatValue,
  recurrenceDays,
  monthlyType,
  startsAt,
  seriesEndsType,
  seriesEndsOn,
  occurrenceCount,
}: GetRecurrenceLabelParams): string {
  if (!isRecurring) return 'Does not repeat';

  let baseLabel = '';

  if (recurrenceFrequency === 'DAY') {
    baseLabel = repeatValue === 1 ? 'Daily' : `Every ${repeatValue} days`;
  } else if (recurrenceFrequency === 'WEEK') {
    const weekdaySet = new Set(['MO', 'TU', 'WE', 'TH', 'FR']);
    const hasWeekdays = recurrenceDays.length === 5 && recurrenceDays.every(d => weekdaySet.has(d));

    if (hasWeekdays && repeatValue === 1) {
      baseLabel = 'Every Weekday (Mon – Fri)';
    } else if (recurrenceDays.length === 1 && repeatValue === 1) {
      const dayKey = recurrenceDays[0];
      baseLabel = dayKey
        ? `Weekly on ${FULL_DAY_NAME[dayKey] ?? 'selected day'}`
        : 'Weekly on selected day';
    } else if (recurrenceDays.length > 0 && repeatValue === 1) {
      const dayNames = recurrenceDays.map(d => SHORT_DAY_NAME[d] || d);
      baseLabel =
        dayNames.length <= 3
          ? `Weekly on ${dayNames.join(', ')}`
          : `Weekly on ${dayNames.length} days`;
    } else if (repeatValue === 1) {
      baseLabel = 'Weekly';
    } else {
      baseLabel = `Every ${repeatValue} weeks`;
    }
  } else if (recurrenceFrequency === 'MONTH') {
    if (monthlyType === 'monthly_day') {
      const dayOfMonth = startsAt.getDate();
      baseLabel =
        repeatValue === 1
          ? `Monthly on day ${dayOfMonth}`
          : `Every ${repeatValue} months on day ${dayOfMonth}`;
    } else {
      const { occurrence, weekday } = getWeekdayOccurrence(startsAt);
      const ordinalWord = ORDINAL_WORDS[occurrence - 1] || `${occurrence}th`;
      baseLabel =
        repeatValue === 1
          ? `Monthly on ${ordinalWord} ${weekday}`
          : `Every ${repeatValue} months on ${ordinalWord} ${weekday}`;
    }
  } else {
    baseLabel = 'Custom';
  }

  if (seriesEndsType === 'on' && seriesEndsOn) {
    const day = seriesEndsOn.getDate();
    const month = seriesEndsOn.toLocaleString('en-US', { month: 'long' });
    return `${baseLabel}, ends on ${day} ${month}`;
  }

  if (seriesEndsType === 'after' && occurrenceCount) {
    return `${baseLabel}, ends after ${occurrenceCount} ${occurrenceCount === 1 ? 'occurrence' : 'occurrences'}`;
  }

  return baseLabel;
}
