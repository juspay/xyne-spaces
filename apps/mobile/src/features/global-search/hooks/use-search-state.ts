import { useReducer, type Dispatch } from 'react';

import type { SearchFilterChip, SearchFilterPrefix } from '../types';
import { isExactSearchQuery } from '../utils/exact-search';
import {
  DEFAULT_STRUCTURED_FILTERS,
  structuredFiltersEqual,
  type StructuredSearchFilters,
} from '../utils/filter-model';
import { clearInapplicableStructured } from '../utils/filter-registry';
import {
  DEFAULT_RANK_PROFILE,
  DEFAULT_SORT_BY,
  type SortBy,
} from '../utils/rank-sort';
import { triggersEqual, type FilterTrigger } from '../utils/filter-trigger';
import type { GlobalSearchTab } from '../utils/search-tabs';

export type SearchState = {
  tab: GlobalSearchTab;
  /** Debounced text with any `from:` / `in:` operator stripped. */
  query: string;
  /** Filters the user picked. A locked conversation scope is never in here. */
  chips: readonly SearchFilterChip[];
  /** Modal-only / structured filters (From/In stay in `chips`). */
  structured: StructuredSearchFilters;
  onlyMyChannels: boolean;
  /** Include BOT messageType hits. Messages tab only; default off. */
  includeBotMessages: boolean;
  /**
   * Exact phrase mode. Folded into `q` as quotes on the way out — not shown in
   * the input. Also turns on when the user types quotes by hand.
   */
  exactMatch: boolean;
  /** Page-level sort — Relevance / Newest / Oldest. Edited in Filters drawer. */
  sortBy: SortBy;
  /**
   * Page-level Vespa rank profile. Empty = use tab default (`default_native`).
   * Reset when the category tab changes (profiles are schema-scoped).
   */
  rankProfile: string;
  /** Live, not debounced. Non-null only inside an unfinished `from:` / `in:`. */
  trigger: FilterTrigger | null;
};

export type SearchAction =
  | { type: 'tabChanged'; tab: GlobalSearchTab }
  | { type: 'queryCommitted'; query: string }
  | { type: 'triggerChanged'; trigger: FilterTrigger | null }
  | { type: 'chipAdded'; chip: SearchFilterChip }
  | { type: 'chipRemoved'; chip: Pick<SearchFilterChip, 'id' | 'prefix'> }
  | { type: 'lastChipRemoved' }
  | { type: 'chipsReplaced'; prefix: SearchFilterPrefix; chips: readonly SearchFilterChip[] }
  | {
      type: 'structuredApplied';
      structured: StructuredSearchFilters;
      chips: readonly SearchFilterChip[];
      onlyMyChannels: boolean;
      sortBy: SortBy;
      rankProfile: string;
    }
  | { type: 'onlyMyChannelsToggled' }
  | { type: 'includeBotMessagesToggled' }
  | { type: 'exactMatchToggled' }
  | { type: 'cleared' };

export type SearchDispatch = Dispatch<SearchAction>;

export function createSearchState(tab: GlobalSearchTab): SearchState {
  return {
    tab,
    query: '',
    chips: [],
    structured: { ...DEFAULT_STRUCTURED_FILTERS },
    onlyMyChannels: false,
    includeBotMessages: false,
    exactMatch: false,
    sortBy: DEFAULT_SORT_BY,
    rankProfile: DEFAULT_RANK_PROFILE,
    trigger: null,
  };
}

function sameChip(
  a: Pick<SearchFilterChip, 'id' | 'prefix'>,
  b: Pick<SearchFilterChip, 'id' | 'prefix'>,
): boolean {
  return a.prefix === b.prefix && a.id === b.id;
}

function chipsEqual(a: readonly SearchFilterChip[], b: readonly SearchFilterChip[]): boolean {
  return (
    a.length === b.length &&
    a.every((chip, index) => {
      const other = b[index];
      return other !== undefined && sameChip(chip, other) && chip.label === other.label;
    })
  );
}

/**
 * Returns the same object whenever an action changes nothing. Chips are part of the
 * request's identity, so a new array for an unchanged selection would refetch.
 */
export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case 'tabChanged': {
      // Drop fields that do not apply to the destination tab; reset rank
      // (profiles are schema-scoped).
      if (state.tab === action.tab) return state;
      const cleared = clearInapplicableStructured(action.tab, state.structured, state.chips);
      return {
        ...state,
        tab: action.tab,
        rankProfile: DEFAULT_RANK_PROFILE,
        structured: cleared.structured,
        chips: cleared.chips,
      };
    }

    case 'queryCommitted': {
      if (state.query === action.query) return state;
      // Typed quotes enable exact mode; the pill stays on until toggled off.
      if (isExactSearchQuery(action.query)) {
        return { ...state, query: action.query, exactMatch: true };
      }
      return { ...state, query: action.query };
    }

    case 'triggerChanged':
      return triggersEqual(state.trigger, action.trigger)
        ? state
        : { ...state, trigger: action.trigger };

    case 'chipAdded':
      return state.chips.some(chip => sameChip(chip, action.chip))
        ? state
        : { ...state, chips: [...state.chips, action.chip] };

    case 'chipRemoved': {
      const chips = state.chips.filter(chip => !sameChip(chip, action.chip));
      return chips.length === state.chips.length ? state : { ...state, chips };
    }

    case 'lastChipRemoved':
      return state.chips.length === 0 ? state : { ...state, chips: state.chips.slice(0, -1) };

    case 'chipsReplaced': {
      // Spliced into the slot the prefix already held, so re-applying an unchanged
      // selection produces an equal list. Appending would reorder it.
      const replacements = action.chips.filter(chip => chip.prefix === action.prefix);
      const anchor = state.chips.findIndex(chip => chip.prefix === action.prefix);
      const others = state.chips.filter(chip => chip.prefix !== action.prefix);
      const insertAt = anchor === -1 ? others.length : anchor;
      const chips = [...others.slice(0, insertAt), ...replacements, ...others.slice(insertAt)];
      return chipsEqual(state.chips, chips) ? state : { ...state, chips };
    }

    case 'structuredApplied': {
      const chipsSame = chipsEqual(state.chips, action.chips);
      const structuredSame = structuredFiltersEqual(state.structured, action.structured);
      const onlyMySame = state.onlyMyChannels === action.onlyMyChannels;
      const sortSame = state.sortBy === action.sortBy;
      const rankSame = state.rankProfile === action.rankProfile;
      if (chipsSame && structuredSame && onlyMySame && sortSame && rankSame) return state;
      return {
        ...state,
        chips: chipsSame ? state.chips : action.chips,
        structured: structuredSame ? state.structured : action.structured,
        onlyMyChannels: action.onlyMyChannels,
        sortBy: action.sortBy,
        rankProfile: action.rankProfile,
      };
    }

    case 'onlyMyChannelsToggled':
      return { ...state, onlyMyChannels: !state.onlyMyChannels };

    case 'includeBotMessagesToggled':
      return { ...state, includeBotMessages: !state.includeBotMessages };

    case 'exactMatchToggled':
      return { ...state, exactMatch: !state.exactMatch };

    case 'cleared':
      return state.query === '' &&
        state.chips.length === 0 &&
        state.trigger === null &&
        structuredFiltersEqual(state.structured, DEFAULT_STRUCTURED_FILTERS)
        ? state
        : {
            ...state,
            query: '',
            chips: [],
            trigger: null,
            structured: { ...DEFAULT_STRUCTURED_FILTERS },
          };
  }
}

/** Owned by the screen, so it starts clean on open and is gone on close. */
export function useSearchState(initialTab: GlobalSearchTab): [SearchState, SearchDispatch] {
  return useReducer(searchReducer, initialTab, createSearchState);
}
