import type { VespaSearchFilters } from '@/src/types/search';
import { buildVespaSearchParams, sanitizeSearchQuery } from '@/src/utils/search';
import type { SearchFilterChip, SearchFilterPrefix, SearchScope } from '../types';
import { toSearchQuery } from './exact-search';
import {
  DEFAULT_STRUCTURED_FILTERS,
  resolveDateKeyword,
  type StructuredSearchFilters,
} from './filter-model';
import { DEFAULT_SORT_BY, type SortBy } from './rank-sort';
import { effectiveInputsForScope } from './scope';
import type { GlobalSearchTab } from './search-tabs';

/** Matches dashboard `BACKEND_RESULTS_LIMIT` — per category, not shared across them. */
export const RESULTS_LIMIT = 25;
/** Vespa caps query offset; stop paginating before the next page would cross it. */
export const MAX_BACKEND_OFFSET = 1000;

export type SearchCategory = 'messages' | 'tickets' | 'files' | 'calls';

export type SearchRequest = {
  category: SearchCategory;
  freeText: string;
  chips: readonly SearchFilterChip[];
  structured: StructuredSearchFilters;
  onlyMyChannels: boolean;
  includeBotMessages: boolean;
  exactMatch: boolean;
  sortBy: SortBy;
  rankProfile: string;
  /** Tab used to resolve the default rank profile. */
  tab: GlobalSearchTab;
};

export type SearchRequestInput = {
  tab: GlobalSearchTab;
  /** Debounced text with any `from:` / `in:` operator already stripped. */
  query: string;
  /** Filters the user picked. Never the locked scope. */
  chips: readonly SearchFilterChip[];
  structured?: StructuredSearchFilters;
  onlyMyChannels: boolean;
  includeBotMessages: boolean;
  exactMatch: boolean;
  sortBy?: SortBy;
  rankProfile?: string;
  scope: SearchScope | null;
};

/** Chats and Channels are searched on-device and never reach the backend. */
const CATEGORY_FOR_TAB: Record<GlobalSearchTab, SearchCategory | null> = {
  messages: 'messages',
  tickets: 'tickets',
  files: 'files',
  calls: 'calls',
  chats: null,
  channels: null,
};

/** Each category is fetched with its own `type` + `apps`, as dashboard does. */
const CATEGORY_WIRE: Record<SearchCategory, { type: string; apps: string }> = {
  messages: { type: 'messages', apps: 'chat' },
  tickets: { type: 'tickets', apps: 'ticket' },
  files: { type: 'files', apps: 'file' },
  calls: { type: 'calls', apps: 'call' },
};

export function categoryForTab(tab: GlobalSearchTab): SearchCategory | null {
  return CATEGORY_FOR_TAB[tab];
}

/** Structured fields that this category actually serializes onto the wire. */
function hasApplicableStructuredInput(
  category: SearchCategory,
  structured: StructuredSearchFilters,
): boolean {
  const hasDates = Boolean(structured.dateRange || structured.after || structured.before);
  if (hasDates) return true;

  if (category === 'messages') {
    return (
      structured.withUsers.length > 0 ||
      structured.mentionUsers.length > 0 ||
      structured.mentionChannels.length > 0 ||
      structured.mentionGroups.length > 0 ||
      structured.tags.length > 0 ||
      structured.entities.length > 0 ||
      structured.fromEmails.length > 0 ||
      structured.toEmails.length > 0
    );
  }

  if (category === 'tickets') {
    return (
      structured.assignees.length > 0 ||
      structured.boards.length > 0 ||
      structured.priority !== '' ||
      structured.statuses.length > 0 ||
      structured.tags.length > 0 ||
      structured.entities.length > 0 ||
      structured.fromEmails.length > 0 ||
      structured.toEmails.length > 0
    );
  }

  if (category === 'calls') {
    return structured.withUsers.length > 0;
  }

  // files — only dates (handled above) apply from the structured set
  return false;
}

/**
 * The request for what is on screen, or `null` when nothing should be sent.
 * Every rule about *whether* to search lives here.
 */
export function buildSearchRequest({
  tab,
  query,
  chips,
  structured = DEFAULT_STRUCTURED_FILTERS,
  onlyMyChannels,
  includeBotMessages,
  exactMatch,
  sortBy = DEFAULT_SORT_BY,
  rankProfile = '',
  scope,
}: SearchRequestInput): SearchRequest | null {
  // Scoped search is a single messages surface with no tabs.
  const category = scope ? 'messages' : categoryForTab(tab);
  if (!category) return null;

  const freeText = query.trim();
  // A locked scope narrows the request; it is not something the user asked for.
  // Mode toggles alone do not count either: alone they would mean "every hit in
  // every channel I am in" / "every bot message".
  // Structured fields only count when this category actually sends them.
  const hasUserInput = scope
    ? freeText.length > 0
    : freeText.length > 0 || chips.length > 0 || hasApplicableStructuredInput(category, structured);
  if (!hasUserInput) return null;

  return {
    category,
    freeText,
    structured,
    sortBy,
    rankProfile,
    tab: scope ? 'messages' : tab,
    ...effectiveInputsForScope({ chips, onlyMyChannels, includeBotMessages, exactMatch }, scope),
  };
}

/** Comma-joined chip ids for one prefix — the backend ORs them. */
function chipIds(
  chips: readonly SearchFilterChip[],
  prefix: SearchFilterPrefix,
): string | undefined {
  const ids = chips.filter(chip => chip.prefix === prefix).map(chip => chip.id);
  return ids.length > 0 ? ids.join(',') : undefined;
}

function entityIds(entities: readonly { id: string }[]): string | undefined {
  return entities.length > 0 ? entities.map(entity => entity.id).join(',') : undefined;
}

function joinList(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(',') : undefined;
}

/**
 * Structured date → Vespa `on` / `after`+`before` / `range`.
 * Presets (e.g. "last 7 days") expand to concrete bounds at the request boundary —
 * same as dashboard `dateBounds` / `searchFilters` — so the wire matches dashboard.
 */
function dateParams(structured: StructuredSearchFilters): Partial<VespaSearchFilters> {
  const { dateRange, after, before } = structured;
  if (after || before) {
    // Equal day bounds must go as `on`: backend treats `before` as < start-of-day and
    // `after` as > end-of-day, so the pair would match nothing.
    if (after && before && after === before) return { on: after };
    return {
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
    };
  }
  if (!dateRange) return {};
  const bounds = resolveDateKeyword(dateRange);
  if (!bounds) return { range: dateRange };
  if (bounds.after === bounds.before) return { on: bounds.after };
  return { after: bounds.after, before: bounds.before };
}

export function buildSearchFilters(
  request: SearchRequest,
  options: { offset?: number } = {},
): VespaSearchFilters {
  const {
    category,
    freeText,
    chips,
    structured = DEFAULT_STRUCTURED_FILTERS,
    onlyMyChannels,
    includeBotMessages,
    exactMatch,
    sortBy,
    rankProfile,
  } = request;
  const from = chipIds(chips, 'from:');
  const inside = chipIds(chips, 'in:');
  const withUsers = entityIds(structured.withUsers);
  const sanitized = sanitizeSearchQuery(freeText);

  const isMessages = category === 'messages';
  const isTickets = category === 'tickets';
  const isCalls = category === 'calls';
  const isMessagesOrTickets = isMessages || isTickets;

  const filters: VespaSearchFilters = {
    query: toSearchQuery(sanitized, exactMatch),
    limit: RESULTS_LIMIT,
    offset: options.offset ?? 0,
    presentationSummary: 'lean',
    ...CATEGORY_WIRE[category],
  };

  /** Entity / facet filters that justify `filterOnly` when the query is empty. */
  let hasAppliedEntityFilter = false;

  // Call search filters on participants via `with` → `withUser`. Message search
  // uses `from:` for senders and structured `withUsers` for the With filter.
  if (from) {
    if (isCalls) filters.with = from;
    else filters.from = from;
    hasAppliedEntityFilter = true;
  }
  if (inside) {
    filters.in = inside;
    hasAppliedEntityFilter = true;
  }
  if (withUsers && (isMessages || (isCalls && !from))) {
    filters.with = withUsers;
    hasAppliedEntityFilter = true;
  }

  if (isMessages) {
    const mentions = entityIds(structured.mentionUsers);
    const channelMentions = entityIds(structured.mentionChannels);
    const groupMentions = entityIds(structured.mentionGroups);
    if (mentions) {
      filters.mentions = mentions;
      hasAppliedEntityFilter = true;
    }
    if (channelMentions) {
      filters.channelMentions = channelMentions;
      hasAppliedEntityFilter = true;
    }
    if (groupMentions) {
      filters.groupMentions = groupMentions;
      hasAppliedEntityFilter = true;
    }
  }

  if (isTickets) {
    const assignee = entityIds(structured.assignees);
    const board = entityIds(structured.boards);
    const status = joinList(structured.statuses);
    if (assignee) {
      filters.assignee = assignee;
      hasAppliedEntityFilter = true;
    }
    if (structured.priority) {
      filters.priority = structured.priority;
      hasAppliedEntityFilter = true;
    }
    if (board) {
      filters.board = board;
      hasAppliedEntityFilter = true;
    }
    if (status) {
      filters.status = status;
      hasAppliedEntityFilter = true;
    }
  }

  if (isMessagesOrTickets) {
    const tags = joinList(structured.tags);
    const entity = joinList(structured.entities);
    const fromEmail = joinList(structured.fromEmails);
    const toEmail = joinList(structured.toEmails);
    if (tags) {
      filters.tags = tags;
      hasAppliedEntityFilter = true;
    }
    if (entity) {
      filters.entity = entity;
      hasAppliedEntityFilter = true;
    }
    if (fromEmail) {
      filters.fromEmail = fromEmail;
      hasAppliedEntityFilter = true;
    }
    if (toEmail) {
      filters.toEmail = toEmail;
      hasAppliedEntityFilter = true;
    }
  }

  const dates = dateParams(structured);
  if (Object.keys(dates).length > 0) {
    Object.assign(filters, dates);
    hasAppliedEntityFilter = true;
  }

  // `in:` carries an implicit `false` so the backend does not re-narrow an explicit
  // channel list to joined channels. The toggle, when on, overrides it.
  if (onlyMyChannels) filters.onlyMyChannels = true;
  else if (inside) filters.onlyMyChannels = false;

  // Bot inclusion only applies to message search (dashboard `appliesTo: isMessageType`).
  if (isMessages) filters.includeBotMessages = includeBotMessages;

  // Show archived inverts excludeArchived on tickets (desk not a mobile tab).
  if (isTickets) filters.excludeArchived = !structured.showArchived;

  if (!freeText && hasAppliedEntityFilter) filters.filterOnly = true;

  // Prefer server-side order so pagination stays consistent with Newest/Oldest.
  if (sortBy !== DEFAULT_SORT_BY) filters.orderBy = sortBy;

  // Only send an explicit Rank pick. Omitting lets the backend use its default —
  // do not force `default_native` on every request.
  if (rankProfile) filters.rankProfile = rankProfile;

  return filters;
}

/**
 * The query string as sent. Also the request's identity: two requests that would
 * produce the same call produce equal params (offset excluded from identity — callers
 * that key by identity should pass offset 0 / omit it).
 */
export function toSearchParams(
  request: SearchRequest,
  options: { offset?: number } = {},
): Record<string, string> {
  return buildVespaSearchParams(buildSearchFilters(request, options));
}

/** Base params used as the React Query key (always page 0). */
export function toSearchIdentityParams(request: SearchRequest): Record<string, string> {
  return toSearchParams(request, { offset: 0 });
}
