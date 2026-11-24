import { clockLabel, dayMonthOf } from './message-time';

/**
 * How the room writes a scheduled message's send time: the tray's choices
 * ("Wed 25 Nov, 9:00 am"), its confirm line and the pill above the field
 * ("Scheduled for tomorrow, 9:00 am"), in the device's zone.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Up to this many days out the pill names the weekday; further, the date. */
const WEEKDAY_DAYS = 6;

/** Calendar days from `now` to `date`, by their local midnights (so DST shifts round away). */
function calendarDaysBetween(now: Date, date: Date): number {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const to = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((to - from) / MS_PER_DAY);
}

/** "Wed 25 Nov". */
export function scheduleDateLabel(date: Date): string {
  return `${WEEKDAYS[date.getDay()] ?? ''} ${dayMonthOf(date)}`;
}

/** "Wed 25 Nov, 9:00 am": a tray row's exact send time. */
export function scheduleWhenLabel(date: Date): string {
  return `${scheduleDateLabel(date)}, ${clockLabel(date)}`;
}

/** "Sends Wed 25 Nov at 9:00 am": the tray's confirm line. */
export function scheduleConfirmLabel(date: Date): string {
  return `Sends ${scheduleDateLabel(date)} at ${clockLabel(date)}`;
}

/** "today", "tomorrow", a weekday within six days ("Fri"), then the date ("25 Nov"). */
function relativeDayOf(date: Date, now: Date): string {
  const days = calendarDaysBetween(now, date);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= WEEKDAY_DAYS) return WEEKDAYS[date.getDay()] ?? dayMonthOf(date);
  return dayMonthOf(date);
}

/**
 * The scheduled pill's line: "Scheduled for tomorrow, 9:00 am" for one
 * message, "3 scheduled · next tomorrow, 9:00 am" for several.
 */
export function scheduledPillLabel(count: number, nextAt: Date, now: Date): string {
  const when = `${relativeDayOf(nextAt, now)}, ${clockLabel(nextAt)}`;
  return count > 1 ? `${count} scheduled · next ${when}` : `Scheduled for ${when}`;
}

/** The pill's screen-reader sentence, which also says what a tap does. */
export function scheduledPillAccessibilityLabel(count: number, nextAt: Date, now: Date): string {
  const when = `${relativeDayOf(nextAt, now)} at ${clockLabel(nextAt)}`;
  const what =
    count > 1
      ? `${count} messages scheduled, the next ${when}.`
      : `A message is scheduled for ${when}.`;
  return `${what} Opens your scheduled messages.`;
}
