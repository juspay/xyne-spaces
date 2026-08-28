import { logger } from '@/utils/logger';

export type ScheduleFrequency = 'WEEKLY' | 'MONTHLY';
export type MonthlyMode = 'DAY_OF_MONTH' | 'NTH_WEEKDAY' | 'LAST_DAY';

export interface ScheduleOptions {
  scheduledTime: string; // "HH:mm" in UTC
  frequency: ScheduleFrequency;
  daysOfWeek?: string; // WEEKLY: e.g. "1,2,3,4,5" (0=Sun...6=Sat)
  monthlyMode?: MonthlyMode;
  dayOfMonth?: number; // DAY_OF_MONTH: 1..28
  weekOrdinal?: string; // NTH_WEEKDAY: "1".."4" | "LAST"
  weekday?: number; // NTH_WEEKDAY: 0=Sun...6=Sat
}

// Builds a 5-field cron ("min hour day-of-month month day-of-week"), interpreted as
// UTC. The `L` (last day/weekday) and `#` (nth weekday) extensions are supported by
// cron-parser, Bull's scheduler dependency.
export function buildCronPattern(opts: ScheduleOptions): string {
  const [hh, mm] = opts.scheduledTime.split(':');
  let pattern: string;

  if (opts.frequency === 'MONTHLY') {
    switch (opts.monthlyMode) {
      case 'DAY_OF_MONTH':
        pattern = `${mm} ${hh} ${opts.dayOfMonth} * *`;
        break;
      case 'LAST_DAY':
        pattern = `${mm} ${hh} L * *`;
        break;
      case 'NTH_WEEKDAY':
        pattern =
          opts.weekOrdinal === 'LAST'
            ? `${mm} ${hh} * * ${opts.weekday}L`
            : `${mm} ${hh} * * ${opts.weekday}#${opts.weekOrdinal}`;
        break;
      default:
        throw new Error(`[CRON-UTILS] Unknown monthlyMode: ${opts.monthlyMode}`);
    }
  } else {
    pattern = `${mm} ${hh} * * ${opts.daysOfWeek}`;
  }

  logger.info(`[CRON-UTILS] Generated cron: ${pattern}`);
  return pattern;
}
