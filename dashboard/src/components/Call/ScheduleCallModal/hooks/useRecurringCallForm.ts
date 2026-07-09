import { useCallback, useEffect, useMemo, useState } from 'react';
import { RRule } from 'rrule';
import type {
  MonthlyType,
  PreviousRecurrenceState,
  RecurrenceFrequency,
  SeriesEndsType,
} from '../types';
import { getRecurrenceLabel, buildRecurrenceRule, DAY_KEYS } from '../recurrence';
import { toHHMM } from '../dateTime';

interface UseRecurringCallFormParams {
  defaultStart: Date;
  startsAt: Date;
  isInitiallyRecurring: boolean;
}

export function useRecurringCallForm({
  defaultStart,
  startsAt,
  isInitiallyRecurring,
}: UseRecurringCallFormParams) {
  const [showCustomPanel, setShowCustomPanel] = useState(false);
  const [previousRecurrenceState, setPreviousRecurrenceState] =
    useState<PreviousRecurrenceState | null>(null);
  const [isRecurring, setIsRecurring] = useState(() => isInitiallyRecurring);
  const [repeatValue, setRepeatValue] = useState<number | ''>(1);
  const [monthlyType, setMonthlyType] = useState<MonthlyType>('monthly_day');
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>('WEEK');
  const [recurrenceDays, setRecurrenceDays] = useState<string[]>([]);
  const [seriesEndsOn, setSeriesEndsOn] = useState<Date | null>(null);
  const [seriesEndsType, setSeriesEndsType] = useState<SeriesEndsType>('never');
  const [occurrenceCount, setOccurrenceCount] = useState<number | ''>(13);
  const [recurringStartTime, setRecurringStartTime] = useState<string>(() => toHHMM(defaultStart));
  const [recurringEndTime, setRecurringEndTime] = useState<string>(() =>
    toHHMM(new Date(defaultStart.getTime() + 60 * 60 * 1000)),
  );

  const applyRRule = useCallback((rruleStr: string) => {
    try {
      const clean = rruleStr.replace(/^RRULE:/i, '');
      const rule = RRule.fromString(clean);
      const opts = rule.options;

      const freqMap: Record<number, RecurrenceFrequency> = {
        [RRule.DAILY]: 'DAY',
        [RRule.WEEKLY]: 'WEEK',
        [RRule.MONTHLY]: 'MONTH',
      };
      const freq = freqMap[opts.freq];
      if (freq) setRecurrenceFrequency(freq);

      setRepeatValue(opts.interval ?? 1);

      if (opts.freq === RRule.WEEKLY && opts.byweekday?.length) {
        const codeMap: Record<number, string> = {
          0: 'MO',
          1: 'TU',
          2: 'WE',
          3: 'TH',
          4: 'FR',
          5: 'SA',
          6: 'SU',
        };
        setRecurrenceDays(
          (opts.byweekday as Array<number | { weekday: number }>).map(w =>
            typeof w === 'number' ? (codeMap[w] ?? 'MO') : (codeMap[w.weekday] ?? 'MO'),
          ),
        );
      } else {
        setRecurrenceDays([]);
      }

      if (opts.freq === RRule.MONTHLY) {
        const weekdays = opts.byweekday as
          | Array<{ weekday?: number; n?: number } | number>
          | undefined;
        const hasNthWeekday = weekdays?.some(
          w => typeof w === 'object' && w !== null && w.n !== undefined,
        );
        const hasByMonthDay = opts.bymonthday?.length;

        if (hasNthWeekday) {
          setMonthlyType('monthly_nth_weekday');
        } else if (hasByMonthDay) {
          setMonthlyType('monthly_day');
        } else {
          setMonthlyType('monthly_day');
        }
      }

      if (opts.count) {
        setSeriesEndsType('after');
        setOccurrenceCount(opts.count);
      } else if (opts.until) {
        setSeriesEndsType('on');
        setSeriesEndsOn(new Date(opts.until));
      }
    } catch {
      // Keep the current UI state if a stored RRULE is malformed.
    }
  }, []);

  useEffect(() => {
    if (!showCustomPanel || recurrenceFrequency !== 'WEEK' || recurrenceDays.length > 0) return;

    const dayIndex = startsAt.getDay();
    if (dayIndex >= 0 && dayIndex < DAY_KEYS.length) {
      const todayKey = DAY_KEYS[dayIndex];
      if (todayKey) {
        setRecurrenceDays([todayKey]);
      }
    }
  }, [showCustomPanel, recurrenceFrequency, recurrenceDays.length, startsAt]);

  const buildRrule = useCallback(
    (): string =>
      buildRecurrenceRule({
        recurrenceFrequency,
        repeatValue,
        recurrenceDays,
        monthlyType,
        startsAt,
        seriesEndsType,
        occurrenceCount,
      }),
    [
      recurrenceFrequency,
      repeatValue,
      recurrenceDays,
      monthlyType,
      startsAt,
      seriesEndsType,
      occurrenceCount,
    ],
  );

  const recurrenceLabel = useMemo(
    () =>
      getRecurrenceLabel({
        isRecurring,
        recurrenceFrequency,
        repeatValue,
        recurrenceDays,
        monthlyType,
        startsAt,
        seriesEndsType,
        seriesEndsOn,
        occurrenceCount,
      }),
    [
      isRecurring,
      recurrenceFrequency,
      repeatValue,
      recurrenceDays,
      monthlyType,
      startsAt,
      seriesEndsType,
      seriesEndsOn,
      occurrenceCount,
    ],
  );

  const toggleRecurrenceDay = useCallback((day: string): void => {
    setRecurrenceDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]));
  }, []);

  const setRecurringTimesFromDates = useCallback((start: Date, end: Date): void => {
    setRecurringStartTime(toHHMM(start));
    setRecurringEndTime(toHHMM(end));
  }, []);

  const resetRecurringState = useCallback(
    (start: Date = defaultStart): void => {
      setIsRecurring(false);
      setRecurrenceFrequency('WEEK');
      setRecurrenceDays([]);
      setSeriesEndsOn(null);
      setSeriesEndsType('never');
      setRecurringStartTime(toHHMM(start));
      setRecurringEndTime(toHHMM(new Date(start.getTime() + 60 * 60 * 1000)));
      setMonthlyType('monthly_day');
      setRepeatValue(1);
      setOccurrenceCount(13);
      setShowCustomPanel(false);
      setPreviousRecurrenceState(null);
    },
    [defaultStart],
  );

  return {
    applyRRule,
    buildRrule,
    isRecurring,
    monthlyType,
    occurrenceCount,
    previousRecurrenceState,
    recurrenceDays,
    recurrenceFrequency,
    recurrenceLabel,
    recurringEndTime,
    recurringStartTime,
    repeatValue,
    resetRecurringState,
    seriesEndsOn,
    seriesEndsType,
    setIsRecurring,
    setMonthlyType,
    setOccurrenceCount,
    setPreviousRecurrenceState,
    setRecurrenceDays,
    setRecurrenceFrequency,
    setRecurringEndTime,
    setRecurringStartTime,
    setRecurringTimesFromDates,
    setRepeatValue,
    setSeriesEndsOn,
    setSeriesEndsType,
    setShowCustomPanel,
    showCustomPanel,
    toggleRecurrenceDay,
  };
}
