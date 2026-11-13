/**
 * Pure formatting + grouping helpers for the Home dashboard.
 *
 * React-free on purpose so it can be unit-tested directly, and clock-free
 * except through an injectable `now`, so tests never have to freeze timers.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ─── Durations ───────────────────────────────────────────────────────────────

/**
 * A duration as `2d 04h`, `4h 30m`, `12m` — the magnitude behind every deadline
 * label. Always non-negative, so clock skew reads as `0m` rather than producing
 * a negative string.
 */
export function formatWaiting(since: Date | string, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(since).getTime());
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const mins = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return `${String(days)}d ${String(hours).padStart(2, '0')}h`;
  if (hours > 0) return `${String(hours)}h ${String(mins).padStart(2, '0')}m`;
  return `${String(mins)}m`;
}

/**
 * Deadline text for a gate that has one: `1h 30m before due`, `2d 04h past due`.
 *
 * Both forms put the number first and end in "due", so the two read as one
 * scale either side of the deadline rather than as two unrelated labels — and
 * neither can be mistaken for a bare elapsed time.
 */
export function formatDue(dueAt: Date | string, now: number = Date.now()): string {
  const diff = new Date(dueAt).getTime() - now;
  const magnitude = formatWaiting(new Date(now - Math.abs(diff)), now);
  return diff < 0 ? `${magnitude} past due` : `${magnitude} before due`;
}

/**
 * The date a gate was raised — `26 Aug 2026`. Date only, no time.
 *
 * Always the same shape: no "Yesterday", no today-only shortening, so two rows
 * can be compared without first working out which format each is using.
 */
export function formatRaisedAt(at: Date | string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(at));
}

// ─── Greeting ────────────────────────────────────────────────────────────────

/** "Monday, 24 August" — locale-aware, no year (it is always the current one). */
export function formatToday(now: number = Date.now()): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(now));
}

/** Time-of-day greeting word. */
export function greetingFor(now: number = Date.now()): string {
  const hour = new Date(now).getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Tone ────────────────────────────────────────────────────────────────────

/**
 * Colour token for an approval row's accent: overdue, due today, or neither.
 *
 * Which bucket a gate is IN is decided by the server, never here — grouping a
 * page in the browser describes the page, not the queue.
 */
export type ApprovalTone = 'danger' | 'warning' | 'neutral';

/**
 * The moment the reader's day ends, as epoch ms — the upper edge of "due today".
 *
 * The server cannot work this out: it has no idea which timezone the reader is
 * in, and its own midnight may be hours from theirs. So the browser computes it
 * and sends it.
 *
 * `setHours(24, 0, 0, 0)` is midnight tonight rather than 23:59:59.999 — an
 * exclusive upper bound, so a gate due at the last millisecond of the day still
 * counts as due today.
 */
export function endOfToday(now: number = Date.now()): number {
  return new Date(now).setHours(24, 0, 0, 0);
}
