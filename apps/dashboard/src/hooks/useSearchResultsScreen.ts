import {
  ALL_FILTER_PARAM_KEYS,
  buildQueryText,
  readFiltersFromParams,
} from '../search/filterRegistry';
import { DEFAULT_SEARCH_FILTERS } from '../search/filterModel';

// Re-exported so existing importers keep working; the model itself lives in filterModel.
export {
  DEFAULT_SEARCH_FILTERS,
  resolveDateKeyword,
  type SearchResultsFilters,
  type StructuredSearchFilters,
} from '../search/filterModel';

/**
 * True when a results URL carries a search worth restoring — text or any filter. A search
 * can be filters-only (`in:#eng status:todo` with no words), so testing the query alone
 * would treat a perfectly good search as empty.
 */
export function hasAnySearchState(params: URLSearchParams): boolean {
  if (params.get('query')?.trim() || params.get('display')?.trim()) return true;
  // `tab` alone is just which tab you're on, not a search — ignore it here.
  return ALL_FILTER_PARAM_KEYS.some(key => key !== 'tab' && Boolean(params.get(key)));
}

/**
 * The structured filters rendered back into the typed syntax the palette speaks. Status,
 * board, tags and dates have no chip of their own, so text is how they survive the trip
 * back into the search box — `parseSearchFilters` re-reads them on the other side.
 *
 * Built from the registry, so a new text-carried filter needs no change here.
 */
export function structuredFiltersToQueryText(params: URLSearchParams): string {
  const filters = { ...DEFAULT_SEARCH_FILTERS, ...readFiltersFromParams(params, {}) };
  return buildQueryText(filters);
}

const LAST_SEARCH_STATE_KEY = 'xyne:last-search-state';

export function saveLastSearchState(search: string): void {
  try {
    sessionStorage.setItem(LAST_SEARCH_STATE_KEY, search);
  } catch {
    // Private mode / storage disabled — restore just falls back to the palette's snapshot.
  }
}

export function readLastSearchState(): URLSearchParams | null {
  try {
    const raw = sessionStorage.getItem(LAST_SEARCH_STATE_KEY);
    return raw ? new URLSearchParams(raw) : null;
  } catch {
    return null;
  }
}

export function clearLastSearchState(): void {
  try {
    sessionStorage.removeItem(LAST_SEARCH_STATE_KEY);
  } catch {
    // Nothing to do — a stale entry is cleared on the next successful write.
  }
}
