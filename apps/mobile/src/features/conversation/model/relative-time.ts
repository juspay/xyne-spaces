const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const DAYS_BEFORE_DATE = 7;

/**
 * Built on first use, not at import: Hermes builds a native formatter per
 * `Intl.DateTimeFormat` (slow), and a formatter captures the zone it was built
 * in. Same reasoning as the DM timestamp formatter.
 */
let dateFormatter: Intl.DateTimeFormat | null = null;

/** Drops the cached formatter so the next call rebuilds in the current timezone. */
export function resetShortRelativeFormatter(): void {
  dateFormatter = null;
}

/**
 * How long ago something happened, in a few characters: "now", "10m ago",
 * "1h ago", "3d ago", then a date ("Sep 22") from a week out.
 *
 * `nowMs` is passed in so the function is pure. A time ahead of now (clock
 * skew) reads as "now". Zero or missing reads as empty.
 */
export function formatShortRelative(timestampMs: number, nowMs: number): string {
  if (!timestampMs) return '';
  const elapsed = nowMs - timestampMs;

  if (elapsed < MS_PER_MINUTE) return 'now';
  if (elapsed < MS_PER_HOUR) return `${Math.floor(elapsed / MS_PER_MINUTE)}m ago`;
  if (elapsed < MS_PER_DAY) return `${Math.floor(elapsed / MS_PER_HOUR)}h ago`;
  if (elapsed < DAYS_BEFORE_DATE * MS_PER_DAY) return `${Math.floor(elapsed / MS_PER_DAY)}d ago`;

  dateFormatter ??= new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });
  return dateFormatter.format(new Date(timestampMs));
}
