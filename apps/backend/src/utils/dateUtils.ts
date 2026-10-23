/**
 * Shared date utility functions
 */

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

/**
 * Get current date in IST timezone formatted as YYYY-MM-DD
 */
export function getCurrentISTDate(): string {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);

  // Use UTC methods on the IST-adjusted date to get the correct day
  const year = istNow.getUTCFullYear();
  const month = String(istNow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istNow.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Get today's date range in IST timezone as UTC Date objects
 * Returns start of today (00:00 IST) and end of today (now) as UTC timestamps
 * This ensures consistency with how the frontend calculates "today"
 */
export function getTodayISTDateRange(): { startDate: Date; endDate: Date } {
  const now = new Date();

  // Get current time in IST (UTC+5:30)
  const istTime = new Date(now.getTime() + IST_OFFSET_MS);

  // Get start of today in IST (00:00:00.000 IST)
  const startOfTodayIST = new Date(Date.UTC(
    istTime.getUTCFullYear(),
    istTime.getUTCMonth(),
    istTime.getUTCDate(),
    0, 0, 0, 0
  ));

  // Convert IST midnight back to UTC for database queries
  // IST 00:00 = UTC 18:30 previous day
  const startOfTodayUTC = new Date(startOfTodayIST.getTime() - IST_OFFSET_MS);

  return {
    startDate: startOfTodayUTC,
    endDate: now
  };
}

/**
 * Given a start instant and two HH:mm time strings, return the end instant.
 * Duration is computed as the difference between the two times in minutes so
 * the result is timezone-agnostic.  Cross-midnight durations (e.g. 23:30 →
 * 00:30) are handled by adding 24 h when the raw difference is ≤ 0.
 */
export function addHHMMDuration(startsAt: Date, startHHMM: string, endHHMM: string): Date {
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  let durationMinutes = (eh! * 60 + em!) - (sh! * 60 + sm!);
  if (durationMinutes <= 0) durationMinutes += 24 * 60;
  return new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
}

/**
 * The instant at which the wall-clock time `hhmm` occurs, in `timeZone`, on the
 * calendar day that `day` falls on in that same zone.
 * e.g. (2026-08-24T07:30Z, "11:00", "Asia/Calcutta") → 2026-08-24T05:30Z
 */
export function atWallClockTime(day: Date, hhmm: string, timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const partsOf = (date: Date) =>
    Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, Number(p.value)])) as
      Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  // Zone offset at an instant: the zone's wall clock read as if it were UTC, minus the instant.
  const offsetAt = (date: Date) => {
    const p = partsOf(date);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
  };

  const { year, month, day: dayOfMonth } = partsOf(day);
  const [h, m] = hhmm.split(':').map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, dayOfMonth, h!, m!);

  // Second pass picks up the offset in force at the result, for days where the zone changes offset.
  const firstGuess = wallAsUtc - offsetAt(new Date(wallAsUtc));
  return new Date(wallAsUtc - offsetAt(new Date(firstGuess)));
}

/**
 * Format a date as a short human-readable date+time string.
 * e.g. "Mon, Feb 26, 4:30 PM"
 */
export function formatDateTimeShort(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format a date to IST locale string for display
 * e.g. "26 Mar 2025, 04:30:00 PM"
 */
export function formatToISTLocaleString(date: Date): string {
  // Use IST timezone for formatting
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
