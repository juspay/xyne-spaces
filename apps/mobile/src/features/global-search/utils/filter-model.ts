/**
 * Filter model shared with the dashboard Filters modal contract.
 * Rendering / URL / Vespa mapping live elsewhere.
 */

export type SearchDocType =
  'all' | 'messages' | 'files' | 'tickets' | 'channels' | 'desk' | 'people' | 'calls';

/** Labeled id for pickers that need a display name after apply. */
export type FilterEntity = {
  id: string;
  label: string;
};

/**
 * Structured filters that live in the Filters sheet (plus carried email/status).
 * From / In stay as search chips on the bar; mode toggles stay as bar pills.
 */
export type StructuredSearchFilters = {
  withUsers: FilterEntity[];
  mentionUsers: FilterEntity[];
  mentionChannels: FilterEntity[];
  mentionGroups: FilterEntity[];
  assignees: FilterEntity[];
  boards: FilterEntity[];
  priority: string;
  statuses: string[];
  tags: string[];
  entities: string[];
  fromEmails: string[];
  toEmails: string[];
  dateRange: string;
  after: string;
  before: string;
  showArchived: boolean;
};

export const DEFAULT_STRUCTURED_FILTERS: StructuredSearchFilters = {
  withUsers: [],
  mentionUsers: [],
  mentionChannels: [],
  mentionGroups: [],
  assignees: [],
  boards: [],
  priority: '',
  statuses: [],
  tags: [],
  entities: [],
  fromEmails: [],
  toEmails: [],
  dateRange: '',
  after: '',
  before: '',
  showArchived: false,
};

/** Full filter snapshot used by registry helpers (badge, visibility, clear). */
export type SearchResultsFilters = StructuredSearchFilters & {
  docType: SearchDocType;
  fromUsers: FilterEntity[];
  inChannels: FilterEntity[];
  onlyMyChannels: boolean;
  includeBotMessages: boolean;
  exactMatch: boolean;
  /** Page-level sort — Relevance / Newest / Oldest. */
  sortBy: 'relevance' | 'newest' | 'oldest';
  /** Page-level Vespa rank profile. Empty = tab default. */
  rankProfile: string;
};

/**
 * Range keywords that map to a whole-day window (`after`/`before` dates).
 * Mirrors dashboard `RESOLVABLE_DATE_KEYWORDS` / backend `timeKeywordParser`.
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

/** Slack-style presets shown in the Filters Date section. */
export const DATE_RANGE_OPTIONS: ReadonlyArray<{
  value: ResolvableDateKeyword | '';
  label: string;
}> = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last 7 days', label: 'Last 7 days' },
  { value: 'last 30 days', label: 'Last 30 days' },
  { value: 'last three months', label: 'Last three months' },
  { value: 'last 12 months', label: 'Last 12 months' },
  { value: 'last three years', label: 'Last three years' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

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
/** Calendar-month shift, clamped so e.g. 31 Mar − 1 month is 28/29 Feb. */
const shiftMonthsUtc = (d: Date, months: number): Date => {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 0, 0, 0, 0));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
};

/**
 * Resolve a relative range keyword to concrete `after`/`before` YYYY-MM-DD bounds.
 * Same windows as dashboard + backend — so the Filters preset selects the same docs.
 * Returns null for unknown / sub-day keywords (those stay as `range:` on the wire).
 */
export function resolveDateKeyword(
  keyword: string,
  now: Date = new Date(),
): { after: string; before: string } | null {
  const key = keyword.trim().toLowerCase();
  if (!isResolvableDateKeyword(key)) return null;
  const startOfThisWeek = startOfWeekUtc(now);
  const startOfThisMonth = startOfMonthUtc(now);
  const lastMonthEnd = new Date(startOfThisMonth.getTime() - DAY_MS);
  const startOfToday = startOfDayUtc(now);
  const yesterday = new Date(startOfToday.getTime() - DAY_MS);
  const windows: Record<ResolvableDateKeyword, { from: Date; to: Date }> = {
    today: { from: startOfToday, to: now },
    'last 24 hours': { from: yesterday, to: now },
    yesterday: { from: yesterday, to: yesterday },
    'last 7 days': { from: new Date(now.getTime() - 7 * DAY_MS), to: now },
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

export const DATE_MODES = [
  { value: '__on__', label: 'On…' },
  { value: '__before__', label: 'Before…' },
  { value: '__after__', label: 'After…' },
  { value: '__range__', label: 'Range…' },
] as const;

export type DateMode = (typeof DATE_MODES)[number]['value'];

export const PRIORITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

export function describeDateBounds(after: string, before: string): string {
  if (after && after === before) return `On ${after}`;
  if (after && before) return `${after} – ${before}`;
  if (after) return `After ${after}`;
  if (before) return `Before ${before}`;
  return '';
}

export function dateModeFor(
  filters: Pick<StructuredSearchFilters, 'after' | 'before'>,
): DateMode | '' {
  const { after, before } = filters;
  if (after && before) return after === before ? '__on__' : '__range__';
  if (after) return '__after__';
  if (before) return '__before__';
  return '';
}

export function parseCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

export function entitiesEqual(a: readonly FilterEntity[], b: readonly FilterEntity[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index];
      return other !== undefined && item.id === other.id && item.label === other.label;
    })
  );
}

export function structuredFiltersEqual(
  a: StructuredSearchFilters,
  b: StructuredSearchFilters,
): boolean {
  return (
    entitiesEqual(a.withUsers, b.withUsers) &&
    entitiesEqual(a.mentionUsers, b.mentionUsers) &&
    entitiesEqual(a.mentionChannels, b.mentionChannels) &&
    entitiesEqual(a.mentionGroups, b.mentionGroups) &&
    entitiesEqual(a.assignees, b.assignees) &&
    entitiesEqual(a.boards, b.boards) &&
    a.priority === b.priority &&
    a.statuses.join('\0') === b.statuses.join('\0') &&
    a.tags.join('\0') === b.tags.join('\0') &&
    a.entities.join('\0') === b.entities.join('\0') &&
    a.fromEmails.join('\0') === b.fromEmails.join('\0') &&
    a.toEmails.join('\0') === b.toEmails.join('\0') &&
    a.dateRange === b.dateRange &&
    a.after === b.after &&
    a.before === b.before &&
    a.showArchived === b.showArchived
  );
}

/**
 * True when any request-affecting structured field is set.
 * `showArchived` is a modifier (like Bot / Exact) — alone it must not start a search.
 */
export function hasStructuredFilterInput(filters: StructuredSearchFilters): boolean {
  return (
    filters.withUsers.length > 0 ||
    filters.mentionUsers.length > 0 ||
    filters.mentionChannels.length > 0 ||
    filters.mentionGroups.length > 0 ||
    filters.assignees.length > 0 ||
    filters.boards.length > 0 ||
    filters.priority !== '' ||
    filters.statuses.length > 0 ||
    filters.tags.length > 0 ||
    filters.entities.length > 0 ||
    filters.fromEmails.length > 0 ||
    filters.toEmails.length > 0 ||
    filters.dateRange !== '' ||
    filters.after !== '' ||
    filters.before !== ''
  );
}

/** Reset draft filter fields (does not touch type / sort / rank / mode pills). */
export function clearStructuredDraft(): StructuredSearchFilters {
  return { ...DEFAULT_STRUCTURED_FILTERS };
}
