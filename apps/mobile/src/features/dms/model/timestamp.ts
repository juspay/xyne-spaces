/**
 * How a conversation's last activity reads in the list.
 *
 * Today     -> a clock time, "4:58 pm"
 * Yesterday -> "Yesterday"
 * This week -> the weekday, "Tuesday"
 * Older     -> the date, month first: "Sept 22"
 *
 * The shared `formatChannelTimestamp` already follows this shape, but it
 * decides which bucket a message falls into from elapsed milliseconds:
 * `Math.floor(diffMs / 86_400_000)`. That is not the same question. A message
 * sent at 11pm and read at 1am is two hours old, so it lands in the "today"
 * bucket and shows a clock time — for a day that has already ended. The same
 * off-by-one walks through every bucket at every midnight.
 *
 * So this counts *calendar* days between two local dates instead, which is
 * the question the design is actually asking.
 */

/**
 * Built once, on first use — not at import.
 *
 * Caching matters: Hermes constructs a new native date formatter for every
 * `Intl.DateTimeFormat`, measured at ~4ms each in
 * `shared/src/utils/comparators.ts`. A list formatting one per visible row at
 * 60fps cannot pay that.
 *
 * Lazily, though, because a formatter captures the timezone it was built in.
 * Building at import binds whatever the zone was when the module first
 * loaded, which on a cold start can precede the device reporting its real
 * one — and then every timestamp renders in the wrong zone until the app is
 * killed. First use is late enough for that to have settled.
 */
type Formatters = {
  time: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
  month: Intl.DateTimeFormat;
};

let formatters: Formatters | null = null;

function getFormatters(): Formatters {
  formatters ??= {
    time: new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: true }),
    weekday: new Intl.DateTimeFormat([], { weekday: 'long' }),
    /**
     * The month name only — the day is composed onto it by `formatMonthDay`.
     *
     * Device locale, so the abbreviation stays the one the user expects:
     * en-GB abbreviates September to "Sept", en-US to "Sep". Pinning the
     * locale to force the order would throw that away along with the order.
     */
    month: new Intl.DateTimeFormat([], { month: 'short' }),
  };
  return formatters;
}

/** Drops the cache so the next call rebuilds in the current timezone. */
export function resetDmTimestampFormatters(): void {
  formatters = null;
}

const MS_PER_DAY = 86_400_000;

/**
 * "Sept 22" — month first, whatever the locale would have chosen.
 *
 * Composed rather than formatted in one pass, because `Intl` gives no way to
 * ask for a locale's month name in an order that locale does not use. Taking
 * the month from `Intl` and the day from the date keeps the abbreviation
 * local while the design's ordering wins.
 *
 * The day is therefore Latin digits even in a locale that numbers
 * differently. Consistent with having already overridden the local ordering,
 * and this list has no non-Latin locale to serve today.
 */
function formatMonthDay(date: Date): string {
  return `${getFormatters().month.format(date)} ${date.getDate()}`;
}

/** Local midnight at the start of the day `ms` falls in. */
export function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Whole calendar days from `timestampMs`'s day to `todayStartMs`.
 *
 * Built from two local midnights rather than a raw subtraction, so a day that
 * crosses a DST boundary still counts as one day.
 */
function calendarDaysAgo(timestampMs: number, todayStartMs: number): number {
  return Math.round((todayStartMs - startOfLocalDay(timestampMs)) / MS_PER_DAY);
}

/**
 * `todayStartMs` is passed in rather than read from the clock so the function
 * is pure — the caller owns "when is now", which is also what lets the list
 * re-label itself at midnight instead of at the next data change.
 */
export function formatDmTimestamp(timestampMs: number, todayStartMs: number): string {
  if (!timestampMs) return '';

  const daysAgo = calendarDaysAgo(timestampMs, todayStartMs);
  const date = new Date(timestampMs);

  // A clock skew or a message dated ahead of now still reads as today rather
  // than as a weekday in the past.
  const { time, weekday } = getFormatters();

  if (daysAgo <= 0) {
    return time.format(date).toLowerCase();
  }
  if (daysAgo === 1) {
    return 'Yesterday';
  }
  if (daysAgo < 7) {
    return weekday.format(date);
  }
  return formatMonthDay(date);
}
