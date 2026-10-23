import { atWallClockTime } from '@/utils/dateUtils';
import { logger } from '@/utils/logger';

/**
 * RRULE dtstart for a recurring call series: the date of `startsOn`, at the series'
 * current `startTime`, both read in the series timezone.
 *
 * startsOn alone is not enough — it keeps the time of day the series was created with,
 * while editing the series time only changes startTime (and shifts already-created
 * instances). Taking the time of day from startTime keeps every newly generated
 * instance at the edited time.
 */
export function seriesRuleAnchor(series: { id: string; startsOn: Date; startTime: string; timezone: string }): Date {
  const startsOn = new Date(series.startsOn);
  try {
    const anchor = atWallClockTime(startsOn, series.startTime, series.timezone);
    // Unedited series: keep the exact original instant (it may carry seconds/ms the
    // first instance was created with, which inclusive range queries compare against).
    return Math.abs(anchor.getTime() - startsOn.getTime()) < 60_000 ? startsOn : anchor;
  } catch (err) {
    logger.error(`Invalid timezone/startTime on series ${series.id}; falling back to startsOn as RRULE anchor`, err);
    return startsOn;
  }
}
