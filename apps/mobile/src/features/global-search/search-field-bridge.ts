import { observable } from '@legendapp/state';

/**
 * Lets the bottom bar host the search field that normally sits in the search
 * screen's toolbar.
 *
 * The screen keeps owning the query — its reducer still drives the results — so
 * there is exactly one source of truth and one commit path. This only moves
 * *where it is typed*. Spaces-only state, so Legend State is the right home for
 * it under the boundary rule in design-system-v2.md §9.
 */
export const searchField$ = observable({
  /** Mirrors the screen's committed query, so the hosted field can show it. */
  query: '',
  placeholder: 'Search',
  /** True while a screen has handed its field over. */
  hosted: false,
});

type SearchFieldHandlers = {
  setQuery: (next: string) => void;
};

let handlers: SearchFieldHandlers | null = null;

/** Called by the screen on mount, and with `null` on unmount. */
export function hostSearchField(next: SearchFieldHandlers | null): void {
  handlers = next;
  searchField$.hosted.set(next !== null);
  if (next === null) searchField$.query.set('');
}

/** Called by the bar's field. A no-op when no screen is hosting. */
export function writeSearchQuery(value: string): void {
  searchField$.query.set(value);
  handlers?.setQuery(value);
}
