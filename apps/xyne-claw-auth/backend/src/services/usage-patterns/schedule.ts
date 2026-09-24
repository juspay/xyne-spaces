/**
 * Weekly-schedule arithmetic for the usage-pattern sync, kept pure so the
 * timing rules can be tested without a clock, a queue or Redis.
 */

/** UTC day-of-week in JS convention (0 = Sunday) mapped to ISO (1 = Monday, 7 = Sunday). */
function isoDay(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

export interface WeeklySlot {
  /** UTC day-of-week, JS convention: 0 = Sunday … 6 = Saturday. */
  day: number;
  hour: number;
  minute: number;
}

/**
 * The ISO week a moment falls in, as `YYYY-Www`.
 *
 * This is the dedupe key for the whole pipeline: the leader lock, the BullMQ
 * job id and the API response all quote it, so "did this agent already get
 * synthesized this week" has exactly one answer no matter which pod asks.
 *
 * ISO weeks run Monday to Sunday and belong to the year containing their
 * Thursday, which is why the year is read off the shifted date rather than off
 * the input — the last days of December frequently belong to week 1 of the
 * next year.
 */
export function weekBucket(at: Date): string {
  const t = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - isoDay(t.getUTCDay()));
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Has this ISO week's slot arrived yet?
 *
 * Deliberately "at or after", not "at" — the fleet is checked on an interval
 * rather than woken by a single long timer, so a pod that boots on Wednesday
 * still runs Monday's sync for that week instead of the roster going stale for
 * six days because a deploy landed on the wrong morning. The week-scoped leader
 * lock is what stops the catch-up from repeating on every later check.
 *
 * Which is also why the slot should sit near the START of the ISO week: a
 * Sunday slot is the last day of its own week, so there is no room left to
 * catch up in.
 */
export function isWeeklySlotDue(now: Date, slot: WeeklySlot): boolean {
  const today = isoDay(now.getUTCDay());
  const target = isoDay(slot.day);
  if (today !== target) return today > target;
  return now.getUTCHours() * 60 + now.getUTCMinutes() >= slot.hour * 60 + slot.minute;
}
