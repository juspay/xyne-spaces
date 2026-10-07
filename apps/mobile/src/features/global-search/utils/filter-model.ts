/**
 * Filter model shared with the dashboard Filters modal contract.
 * Rendering / URL / Vespa mapping live elsewhere.
 */

export type SearchDocType =
  | 'all'
  | 'messages'
  | 'files'
  | 'tickets'
  | 'channels'
  | 'desk'
  | 'people';

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
};

export const DATE_RANGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last 7 days', label: 'Last 7 days' },
  { value: 'last 30 days', label: 'Last 30 days' },
  { value: 'last three months', label: 'Last three months' },
  { value: 'last 12 months', label: 'Last 12 months' },
  { value: 'last three years', label: 'Last three years' },
];

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

export function dateModeFor(filters: Pick<StructuredSearchFilters, 'after' | 'before'>): DateMode | '' {
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

/** True when any modal-counted / request-affecting structured field is set. */
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
    filters.before !== '' ||
    filters.showArchived
  );
}

/** Reset draft filter fields (does not touch type / sort / rank / mode pills). */
export function clearStructuredDraft(): StructuredSearchFilters {
  return { ...DEFAULT_STRUCTURED_FILTERS };
}
