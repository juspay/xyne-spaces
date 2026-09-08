/**
 * The filter model: what a search's filters ARE, with no opinion on how they're rendered,
 * serialised or queried. Kept apart from both the registry and the hook so those can
 * import it one-way — a cycle here is a module-init crash, not a type error.
 */
/**
 * The chip prefixes — the vocabulary of the `from:`/`in:`/`with:` syntax.
 *
 * Lives here, in the dependency-free model, because both the palette's editor types and
 * the filter registry need it and neither may import the other. It was previously written
 * out inline in three places, in three different orders.
 *
 * NOT the same as the editor's typeahead triggers (`@`, `in:@`), which are about what the
 * user is typing, not what a finished chip is — see `UserTriggerType`.
 */
export const CHIP_PREFIXES = [
  'from:',
  'to:',
  'in:',
  'with:',
  'mentions:',
  'assignee:',
  'priority:',
  'board:',
  // Date chips are value filters like priority — a window, not an entity.
  'on:',
  'after:',
  'before:',
] as const;

export type ChipPrefix = (typeof CHIP_PREFIXES)[number];

/** Narrows an arbitrary string to a known prefix, so callers can look up rather than branch. */
export const isChipPrefix = (value: string): value is ChipPrefix =>
  (CHIP_PREFIXES as readonly string[]).includes(value);

export interface SearchResultsFilters {
  docType: 'all' | 'messages' | 'files' | 'tickets' | 'channels' | 'desk' | 'people';
  fromUserIds: string[];
  fromEmails: string[];
  toEmails: string[];
  inChannelIds: string[];
  assigneeIds: string[];
  // `with:` chips — message/call participants, carried over from the palette.
  withUserIds: string[];
  // Bare @user / #channel mention filters (no prefix) — searched as message mentions.
  mentionUserIds: string[];
  mentionChannelIds: string[];
  // Ticket power-filters. Typed syntax (`status:`, `board:`, …) still works and feeds the
  // same backend fields; these carry the values picked in the Filters popover.
  priority: string;
  /** statusV2 enum values. Typed syntax only — see the registry entry for why. */
  statuses: string[];
  boardIds: string[];
  tags: string[];
  // Date range: either a keyword (`range:last 7 days`) or explicit bounds (YYYY-MM-DD).
  dateRange: string;
  after: string;
  before: string;
  sortBy: 'relevance' | 'newest' | 'oldest';
  includeBotMessages: boolean;
  /** Phrase search. The query is quoted when the request is built, never in the box. */
  exactMatch: boolean;
  onlyMyChannels: boolean;
  rankProfile: string;
}

export const DEFAULT_SEARCH_FILTERS: SearchResultsFilters = {
  docType: 'all',
  fromUserIds: [],
  fromEmails: [],
  toEmails: [],
  inChannelIds: [],
  assigneeIds: [],
  withUserIds: [],
  mentionUserIds: [],
  mentionChannelIds: [],
  priority: '',
  statuses: [],
  boardIds: [],
  tags: [],
  dateRange: '',
  after: '',
  before: '',
  sortBy: 'relevance',
  includeBotMessages: false,
  exactMatch: false,
  onlyMyChannels: true,
  rankProfile: '',
};

/**
 * Range keywords that map to a whole-day window, so they can be expressed as concrete
 * `after`/`before` dates.
 *
 * Typing this rather than `string` is what ties the Date dropdown to the resolver: a preset
 * whose keyword isn't here fails to compile, instead of silently resolving to null and
 * degrading to an unresolved `range:` the backend may not understand.
 *
 * Deliberately excludes the sub-day keywords (`last hour`, `this morning`, `this
 * afternoon`) — a date-only window would widen them into a different result set, so they
 * travel as the keyword for the backend to resolve exactly.
 */
export const RESOLVABLE_DATE_KEYWORDS = [
  'today',
  'yesterday',
  'last 24 hours',
  'last 7 days',
  'last 30 days',
  'last three months',
  'last 12 months',
  'last three years',
  'this week',
  'last week',
  'this month',
  'last month',
] as const;

export type ResolvableDateKeyword = (typeof RESOLVABLE_DATE_KEYWORDS)[number];

export const isResolvableDateKeyword = (value: string): value is ResolvableDateKeyword =>
  (RESOLVABLE_DATE_KEYWORDS as readonly string[]).includes(value);

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC day/week/month boundaries, mirroring the backend's timeKeywordParser helpers. */
const startOfDayUtc = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfMonthUtc = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
/** Monday-start, matching the backend (date-fns would default to Sunday). */
const startOfWeekUtc = (d: Date): Date => {
  const day = d.getUTCDay();
  const shift = day === 0 ? 6 : day - 1;
  return new Date(startOfDayUtc(d).getTime() - shift * DAY_MS);
};
const asDate = (d: Date): string => d.toISOString().slice(0, 10);
/** Calendar-month shift, clamped so e.g. 31 Mar − 1 month is 28/29 Feb rather than 3 Mar. */
const shiftMonthsUtc = (d: Date, months: number): Date => {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 0, 0, 0, 0));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
};

/**
 * A relative range keyword resolved to the concrete window it stands for, so the palette
 * can show `after:2026-07-01 before:2026-07-31` instead of an opaque `range:last month`.
 *
 * The windows mirror `apps/backend/src/vespa/src/utils/timeKeywordParser.ts` — same UTC
 * boundaries, same Monday week-start — so the resolved dates select the same documents the
 * keyword did. Returns null for anything not in that vocabulary, which then travels as the
 * keyword it already was.
 */
export function resolveDateKeyword(
  keyword: string,
  now: Date = new Date(),
): { after: string; before: string } | null {
  // Input is free text (a hand-typed `range:` can say anything), so it's narrowed rather
  // than assumed. Anything outside the vocabulary returns null and travels as the keyword.
  const key = keyword.trim().toLowerCase();
  if (!isResolvableDateKeyword(key)) return null;
  const startOfThisWeek = startOfWeekUtc(now);
  const startOfThisMonth = startOfMonthUtc(now);
  const lastMonthEnd = new Date(startOfThisMonth.getTime() - DAY_MS);
  const startOfToday = startOfDayUtc(now);
  const yesterday = new Date(startOfToday.getTime() - DAY_MS);
  // Whole-day windows only. Sub-day keywords (`last hour`, `this morning`, `this
  // afternoon`) have no honest date form — flattening them to today would widen the search
  // — so they aren't resolved and travel as the keyword, which the backend reads exactly.
  const windows: Record<ResolvableDateKeyword, { from: Date; to: Date }> = {
    today: { from: startOfToday, to: now },
    'last 24 hours': { from: yesterday, to: now },
    yesterday: { from: yesterday, to: yesterday },
    'last 7 days': { from: new Date(now.getTime() - 7 * DAY_MS), to: now },
    // Longer spans are month/year arithmetic, not a multiple of 30 days.
    'last three months': { from: shiftMonthsUtc(now, -3), to: now },
    'last 12 months': { from: shiftMonthsUtc(now, -12), to: now },
    'last three years': { from: shiftMonthsUtc(now, -36), to: now },
    'last 30 days': { from: new Date(now.getTime() - 30 * DAY_MS), to: now },
    'this week': { from: startOfThisWeek, to: now },
    'last week': {
      from: new Date(startOfThisWeek.getTime() - 7 * DAY_MS),
      to: new Date(startOfThisWeek.getTime() - DAY_MS),
    },
    'this month': { from: startOfThisMonth, to: now },
    'last month': { from: startOfMonthUtc(lastMonthEnd), to: lastMonthEnd },
  };
  const window = windows[key];
  return { after: asDate(window.from), before: asDate(window.to) };
}

/**
 * Structured (non-chip) filters the results page pushes into the search hook. Mirrors the
 * `parseSearchFilters` shape so the hook can merge them over anything typed in the query.
 */
export interface StructuredSearchFilters {
  /** Single-day window, the `on:` chip's value. */
  on?: string;
  status?: string;
  board?: string;
  tags?: string;
  before?: string;
  after?: string;
  range?: string;
}
