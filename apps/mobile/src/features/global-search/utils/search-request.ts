import type { VespaSearchFilters } from '@/src/types/search';
import { buildVespaSearchParams, sanitizeSearchQuery } from '@/src/utils/search';
import type { SearchFilterChip, SearchFilterPrefix, SearchScope } from '../types';
import { effectiveInputsForScope } from './scope';
import type { GlobalSearchTab } from './search-tabs';

/** Matches dashboard `BACKEND_RESULTS_LIMIT` — per category, not shared across them. */
const RESULTS_LIMIT = 25;

export type SearchCategory = 'messages' | 'tickets' | 'files' | 'calls';

export type SearchRequest = {
  category: SearchCategory;
  freeText: string;
  chips: readonly SearchFilterChip[];
  onlyMyChannels: boolean;
};

export type SearchRequestInput = {
  tab: GlobalSearchTab;
  /** Debounced text with any `from:` / `in:` operator already stripped. */
  query: string;
  /** Filters the user picked. Never the locked scope. */
  chips: readonly SearchFilterChip[];
  onlyMyChannels: boolean;
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

/**
 * The request for what is on screen, or `null` when nothing should be sent.
 * Every rule about *whether* to search lives here.
 */
export function buildSearchRequest({
  tab,
  query,
  chips,
  onlyMyChannels,
  scope,
}: SearchRequestInput): SearchRequest | null {
  // Scoped search is a single messages surface with no tabs.
  const category = scope ? 'messages' : categoryForTab(tab);
  if (!category) return null;

  const freeText = query.trim();
  // A locked scope narrows the request; it is not something the user asked for.
  // `onlyMyChannels` does not count either: alone it would mean "every message in
  // every channel I am in".
  const hasUserInput = scope ? freeText.length > 0 : freeText.length > 0 || chips.length > 0;
  if (!hasUserInput) return null;

  return { category, freeText, ...effectiveInputsForScope({ chips, onlyMyChannels }, scope) };
}

/** Comma-joined chip ids for one prefix — the backend ORs them. */
function chipIds(
  chips: readonly SearchFilterChip[],
  prefix: SearchFilterPrefix,
): string | undefined {
  const ids = chips.filter(chip => chip.prefix === prefix).map(chip => chip.id);
  return ids.length > 0 ? ids.join(',') : undefined;
}

export function buildSearchFilters(request: SearchRequest): VespaSearchFilters {
  const { category, freeText, chips, onlyMyChannels } = request;
  const from = chipIds(chips, 'from:');
  const inside = chipIds(chips, 'in:');

  return {
    query: sanitizeSearchQuery(freeText),
    limit: RESULTS_LIMIT,
    offset: 0,
    presentationSummary: 'lean',
    ...CATEGORY_WIRE[category],
    // Call search filters on participants, message search on the sender, but both
    // read the same `from:` chips.
    ...(from ? (category === 'calls' ? { with: from } : { from }) : {}),
    ...(inside ? { in: inside } : {}),
    // `in:` carries an implicit `false` so the backend does not re-narrow an explicit
    // channel list to joined channels. The toggle, when on, overrides it.
    ...(onlyMyChannels ? { onlyMyChannels: true } : inside ? { onlyMyChannels: false } : {}),
    ...(!freeText && (from || inside) ? { filterOnly: true } : {}),
  };
}

/**
 * The query string as sent. Also the request's identity: two requests that would
 * produce the same call produce equal params.
 */
export function toSearchParams(request: SearchRequest): Record<string, string> {
  return buildVespaSearchParams(buildSearchFilters(request));
}
