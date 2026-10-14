import { RRule, type Weekday } from 'rrule';

export type RecurrencePreset = 'daily' | 'weekdays' | 'monthly' | 'custom';

const WEEKDAY_NUMBERS = new Set([
  RRule.MO.weekday,
  RRule.TU.weekday,
  RRule.WE.weekday,
  RRule.TH.weekday,
  RRule.FR.weekday,
]);

export function getRecurrencePreset(rruleStr: string): RecurrencePreset {
  try {
    const options = RRule.parseString(rruleStr.replace(/^RRULE:/i, ''));
    const byweekday = options.byweekday == null ? [] : [options.byweekday].flat();
    const days = byweekday.filter((day): day is Weekday => typeof day === 'object');
    const isPlain = days.length === byweekday.length && !options.bymonthday;

    if (options.count || options.until || (options.interval ?? 1) !== 1 || !isPlain) {
      return 'custom';
    }
    if (options.freq === RRule.DAILY && days.length === 0) return 'daily';
    if (
      options.freq === RRule.WEEKLY &&
      days.length === WEEKDAY_NUMBERS.size &&
      days.every(day => day.n === undefined && WEEKDAY_NUMBERS.has(day.weekday))
    ) {
      return 'weekdays';
    }
    if (options.freq === RRule.MONTHLY && days.length === 1 && days[0]?.n !== undefined) {
      return 'monthly';
    }
    return 'custom';
  } catch {
    return 'custom';
  }
}
