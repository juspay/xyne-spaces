// Ported from xyne-spaces apps/dashboard ScheduleCallModal/hooks/useRecurringCallForm.ts, trimmed
// to what the preset-only Repeat screen uses. Interval, end rule and occurrence count are fixed
// until the Custom editor exists; re-port its state (and applyRRule, toggleRecurrenceDay, reset)
// from the dashboard then.
import { useCallback, useMemo, useState } from 'react';
import type { MonthlyType, RecurrenceFrequency, SeriesEndsType } from '../utils/types';
import { getRecurrenceLabel, buildRecurrenceRule } from '../utils/recurrence';

const REPEAT_VALUE = 1;
const SERIES_ENDS_TYPE: SeriesEndsType = 'never';
const OCCURRENCE_COUNT = 13;

interface UseRecurringCallFormParams {
  startsAt: Date;
}

export interface RecurringCallForm {
  buildRrule: () => string;
  isRecurring: boolean;
  monthlyType: MonthlyType;
  recurrenceDays: string[];
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceLabel: string;
  setIsRecurring: (on: boolean) => void;
  setMonthlyType: (type: MonthlyType) => void;
  setRecurrenceDays: (days: string[]) => void;
  setRecurrenceFrequency: (frequency: RecurrenceFrequency) => void;
}

export function useRecurringCallForm({ startsAt }: UseRecurringCallFormParams): RecurringCallForm {
  const [isRecurring, setIsRecurring] = useState(false);
  const [monthlyType, setMonthlyType] = useState<MonthlyType>('monthly_day');
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>('WEEK');
  const [recurrenceDays, setRecurrenceDays] = useState<string[]>([]);

  const buildRrule = useCallback(
    (): string =>
      buildRecurrenceRule({
        recurrenceFrequency,
        repeatValue: REPEAT_VALUE,
        recurrenceDays,
        monthlyType,
        startsAt,
        seriesEndsType: SERIES_ENDS_TYPE,
        occurrenceCount: OCCURRENCE_COUNT,
      }),
    [recurrenceFrequency, recurrenceDays, monthlyType, startsAt],
  );

  const recurrenceLabel = useMemo(
    () =>
      getRecurrenceLabel({
        isRecurring,
        recurrenceFrequency,
        repeatValue: REPEAT_VALUE,
        recurrenceDays,
        monthlyType,
        startsAt,
        seriesEndsType: SERIES_ENDS_TYPE,
        seriesEndsOn: null,
        occurrenceCount: OCCURRENCE_COUNT,
      }),
    [isRecurring, recurrenceFrequency, recurrenceDays, monthlyType, startsAt],
  );

  return {
    buildRrule,
    isRecurring,
    monthlyType,
    recurrenceDays,
    recurrenceFrequency,
    recurrenceLabel,
    setIsRecurring,
    setMonthlyType,
    setRecurrenceDays,
    setRecurrenceFrequency,
  };
}
