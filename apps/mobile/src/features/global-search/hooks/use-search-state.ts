import { useReducer, type Dispatch } from 'react';

import type { SearchFilterChip, SearchFilterPrefix } from '../types';
import { triggersEqual, type FilterTrigger } from '../utils/filter-trigger';
import type { GlobalSearchTab } from '../utils/search-tabs';

export type SearchState = {
  tab: GlobalSearchTab;
  /** Debounced text with any `from:` / `in:` operator stripped. */
  query: string;
  /** Filters the user picked. A locked conversation scope is never in here. */
  chips: readonly SearchFilterChip[];
  onlyMyChannels: boolean;
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
  | { type: 'onlyMyChannelsToggled' }
  | { type: 'cleared' };

export type SearchDispatch = Dispatch<SearchAction>;

export function createSearchState(tab: GlobalSearchTab): SearchState {
  return { tab, query: '', chips: [], onlyMyChannels: false, trigger: null };
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
    case 'tabChanged':
      return state.tab === action.tab ? state : { ...state, tab: action.tab };

    case 'queryCommitted':
      return state.query === action.query ? state : { ...state, query: action.query };

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

    case 'onlyMyChannelsToggled':
      return { ...state, onlyMyChannels: !state.onlyMyChannels };

    case 'cleared':
      return state.query === '' && state.chips.length === 0 && state.trigger === null
        ? state
        : { ...state, query: '', chips: [], trigger: null };
  }
}

/** Owned by the screen, so it starts clean on open and is gone on close. */
export function useSearchState(initialTab: GlobalSearchTab): [SearchState, SearchDispatch] {
  return useReducer(searchReducer, initialTab, createSearchState);
}
