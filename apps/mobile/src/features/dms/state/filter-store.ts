import { observable } from '@legendapp/state';

import type { DmFilterCounts } from '@/src/hooks/useDmList';

import { DEFAULT_DM_FILTER, type DmFilter } from '../model/filter';

/**
 * Which chip is active.
 *
 * Module-level rather than component state; the screen stays mounted
 * across tab switches, and the chip and the list both need it without
 * either owning the other. A `useState` here would have to be lifted
 * to the screen and drilled through both.
 *
 * Deliberately not persisted. A filter is a view, not a preference -
 * coming back from a cold start into "Unread" hides conversations the
 * user never asked to hide. Persisting is
 * `syncObservabl(dmFilter$,...)` if that turns out to be wrong.
 */
export const dmFilter$ = observable<DmFilter>(DEFAULT_DM_FILTER);

export function setDmFilter(filter: DmFilter): void {
  dmFilter$.set(filter);
}

/**
 * How many conversations each chip would show.
 *
 * Its own observable, keyed by filter, for the same reason the rows are: a
 * chip subscribes to its own number, so a DM being marked read re-renders
 * the Unread chip and leaves Starred and Groups untouched.
 */
export const dmFilterCounts$ = observable<DmFilterCounts>({
  all: 0,
  unread: 0,
  starred: 0,
  groups: 0,
});

export function setDmFilterCounts(counts: DmFilterCounts): void {
  dmFilterCounts$.set(counts);
}
