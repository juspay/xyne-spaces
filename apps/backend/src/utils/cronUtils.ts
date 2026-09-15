import { logger } from '@/utils/logger';

export type MonthlyMode = 'DAY_OF_MONTH' | 'NTH_WEEKDAY';

// daysOfWeek sentinel that marks a schedule as monthly rather than weekly.
export const MONTHLY_DOW = '-';

export interface ScheduleOptions {
  scheduledTime: string; // "HH:mm" in UTC
  daysOfWeek: string; // weekly day list "0,1,2,3,4,5,6", or "-" for monthly
  monthlyMode?: MonthlyMode | null;
  monthlyValue?: number | null;
}

// NTH_WEEKDAY packs two values into one int, base-10: ordinal*10 + weekday
// (ordinal 1..4 or 5=last; weekday 0=Sun..6=Sat). e.g. 2nd Tuesday = 22, last Friday = 55.
export function decodeNthWeekday(value: number): { ordinal: number; weekday: number } {
  return { ordinal: Math.floor(value / 10), weekday: value % 10 };
}

// Builds a 5-field cron ("min hour day-of-month month day-of-week"), interpreted as
// UTC. The `L` (last day/weekday) and `#` (nth weekday) extensions are supported by
// cron-parser, Bull's scheduler dependency.
export function buildCronPattern(opts: ScheduleOptions): string {
  const [hh, mm] = opts.scheduledTime.split(':');
  let pattern: string;

  if (opts.daysOfWeek === MONTHLY_DOW) {
    const value = opts.monthlyValue ?? 0;
    if (opts.monthlyMode === 'DAY_OF_MONTH') {
      pattern = value === -1 ? `${mm} ${hh} L * *` : `${mm} ${hh} ${value} * *`;
    } else if (opts.monthlyMode === 'NTH_WEEKDAY') {
      const { ordinal, weekday } = decodeNthWeekday(value);
      pattern =
        ordinal === 5 ? `${mm} ${hh} * * ${weekday}L` : `${mm} ${hh} * * ${weekday}#${ordinal}`;
    } else {
      throw new Error(`[CRON-UTILS] Unknown monthlyMode: ${opts.monthlyMode}`);
    }
  } else {
    pattern = `${mm} ${hh} * * ${opts.daysOfWeek}`;
  }

  logger.info(`[CRON-UTILS] Generated cron: ${pattern}`);
  return pattern;
}
