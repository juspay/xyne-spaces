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

/**
 * Single place for category → wire facet rules (chips + structured).
 * Answers both “what goes on the request” and “is there anything to search for”.
 * Modifiers (bots, archived, sort, rank, @Ch) are applied separately — alone they
 * must not start a search.
 */
function collectSearchFacets(
  category: SearchCategory,
  chips: readonly SearchFilterChip[],
  structured: StructuredSearchFilters,
): { facets: Partial<VespaSearchFilters>; hasFacets: boolean } {
  const facets: Partial<VespaSearchFilters> = {};
  let hasFacets = false;

  const put = (key: keyof VespaSearchFilters, value: string | undefined): void => {
    if (!value) return;
    // Facet values on the wire are always strings here.
    (facets as Record<string, string>)[key] = value;
    hasFacets = true;
  };

  const from = chipIds(chips, 'from:');
  const inside = chipIds(chips, 'in:');
  const withUsers = entityIds(structured.withUsers);
  const isMessages = category === 'messages';
  const isTickets = category === 'tickets';
  const isCalls = category === 'calls';

  // Calls: from: chips map to participant `with`. Messages: from: is sender.
  if (from) put(isCalls ? 'with' : 'from', from);
  if (inside) put('in', inside);
  if (withUsers && (isMessages || (isCalls && !from))) put('with', withUsers);

  if (isMessages) {
    put('mentions', entityIds(structured.mentionUsers));
    put('channelMentions', entityIds(structured.mentionChannels));
    put('groupMentions', entityIds(structured.mentionGroups));
  }

  if (isTickets) {
    put('assignee', entityIds(structured.assignees));
    put('priority', structured.priority || undefined);
    put('board', entityIds(structured.boards));
    put('status', joinList(structured.statuses));
  }

  if (isMessages || isTickets) {
    put('tags', joinList(structured.tags));
    put('entity', joinList(structured.entities));
    put('fromEmail', joinList(structured.fromEmails));
    put('toEmail', joinList(structured.toEmails));
  }

  const dates = dateParams(structured);
  if (Object.keys(dates).length > 0) {
    Object.assign(facets, dates);
    hasFacets = true;
  }

  return { facets, hasFacets };
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
  // Mode toggles / sort / rank alone do not count either.
  // Facets only count when this category actually sends them (same rules as the wire).
  const hasUserInput = scope
    ? freeText.length > 0
    : freeText.length > 0 || collectSearchFacets(category, chips, structured).hasFacets;
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
  const sanitized = sanitizeSearchQuery(freeText);
  const isMessages = category === 'messages';
  const isTickets = category === 'tickets';
  const inside = chipIds(chips, 'in:');
  const { facets, hasFacets } = collectSearchFacets(category, chips, structured);

  const filters: VespaSearchFilters = {
    query: toSearchQuery(sanitized, exactMatch),
    limit: RESULTS_LIMIT,
    offset: options.offset ?? 0,
    presentationSummary: 'lean',
    ...CATEGORY_WIRE[category],
    ...facets,
  };

  // `in:` carries an implicit `false` so the backend does not re-narrow an explicit
  // channel list to joined channels. The toggle, when on, overrides it.
  if (onlyMyChannels) filters.onlyMyChannels = true;
  else if (inside) filters.onlyMyChannels = false;

  // Bot inclusion only applies to message search (dashboard `appliesTo: isMessageType`).
  if (isMessages) filters.includeBotMessages = includeBotMessages;

  // Show archived inverts excludeArchived on tickets (desk not a mobile tab).
  if (isTickets) filters.excludeArchived = !structured.showArchived;

  if (!freeText && hasFacets) filters.filterOnly = true;

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
