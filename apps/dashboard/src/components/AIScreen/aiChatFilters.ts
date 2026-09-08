/**
 * Date-filter parsing for the AI-chat search source in Cmd+K. `before:`/`after:`/
 * `on:`/`range:` are parsed by the shared searchFilterParser (multi-word aware);
 * this turns those parsed values into a [fromMs, toMs] window over lastMessageAt.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parse a single date token to a Date at local midnight, or null. Supports
 *  ISO (YYYY-MM-DD), `today`/`yesterday`, and `d MMM yy(yy)`. */
function parseDateToken(value: string): Date | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (v === 'today') return today;
  if (v === 'yesterday') {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return d;
  }
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const dmy = v.match(/^(\d{1,2})\s+([a-z]{3,})\s+(\d{2,4})$/);
  if (dmy) {
    const mon = MONTHS.indexOf(dmy[2]!.slice(0, 3));
    if (mon >= 0) {
      let year = Number(dmy[3]);
      if (year < 100) year += 2000;
      const d = new Date(year, mon, Number(dmy[1]));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Turn a `range:` keyword into [fromMs, toMs] (toMs null = up to now). */
function rangeBounds(keyword: string): { fromMs: number | null; toMs: number | null } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const k = keyword.trim().toLowerCase();

  const lastNDays = k.match(/^last\s+(\d+)\s+days?$/);
  if (lastNDays) return { fromMs: now.getTime() - Number(lastNDays[1]) * DAY_MS, toMs: null };
  const lastNHours = k.match(/^last\s+(\d+)\s+hours?$/);
  if (lastNHours) return { fromMs: now.getTime() - Number(lastNHours[1]) * 60 * 60 * 1000, toMs: null };

  switch (k) {
    case 'today':
      return { fromMs: startOfToday.getTime(), toMs: null };
    case 'yesterday': {
      const start = startOfToday.getTime() - DAY_MS;
      return { fromMs: start, toMs: startOfToday.getTime() };
    }
    case 'last hour':
      return { fromMs: now.getTime() - 60 * 60 * 1000, toMs: null };
    case 'last 24 hours':
      return { fromMs: now.getTime() - DAY_MS, toMs: null };
    case 'this week': {
      const d = new Date(startOfToday);
      d.setDate(d.getDate() - d.getDay());
      return { fromMs: d.getTime(), toMs: null };
    }
    case 'last week': {
      const end = new Date(startOfToday);
      end.setDate(end.getDate() - end.getDay());
      const start = new Date(end);
      start.setDate(start.getDate() - 7);
      return { fromMs: start.getTime(), toMs: end.getTime() };
    }
    case 'this month': {
      const d = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);
      return { fromMs: d.getTime(), toMs: null };
    }
    case 'last month': {
      const end = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);
      const start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
      return { fromMs: start.getTime(), toMs: end.getTime() };
    }
    default:
      return { fromMs: null, toMs: null };
  }
}

/** The date-related fields produced by parseSearchFilters. */
export interface DateFilterValues {
  before?: string | undefined;
  after?: string | undefined;
  on?: string | undefined;
  range?: string | undefined;
}

/**
 * Collapse the parsed date filters into a single [fromMs, toMs] window applied
 * to a conversation's lastMessageAt. before/after/on refine the same window;
 * range provides its own. Unparseable tokens are ignored (best-effort, like
 * Cmd+K's lenient backend parsing). Returns whether any date filter was active
 * so the caller can tell "no filter" from "filter that parsed to no bound".
 */
export function computeDateBounds(v: DateFilterValues): {
  fromMs: number | null;
  toMs: number | null;
  active: boolean;
} {
  let fromMs: number | null = null;
  let toMs: number | null = null;
  const active = Boolean(v.before || v.after || v.on || v.range);
  const tighten = (f: number | null, t: number | null): void => {
    if (f !== null) fromMs = fromMs === null ? f : Math.max(fromMs, f);
    if (t !== null) toMs = toMs === null ? t : Math.min(toMs, t);
  };

  if (v.after) {
    const d = parseDateToken(v.after);
    if (d) tighten(d.getTime(), null);
  }
  if (v.before) {
    const d = parseDateToken(v.before);
    if (d) tighten(null, d.getTime());
  }
  if (v.on) {
    const d = parseDateToken(v.on);
    if (d) tighten(d.getTime(), d.getTime() + DAY_MS);
  }
  if (v.range) {
    const b = rangeBounds(v.range);
    tighten(b.fromMs, b.toMs);
  }
  return { fromMs, toMs, active };
}
