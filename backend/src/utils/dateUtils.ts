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
