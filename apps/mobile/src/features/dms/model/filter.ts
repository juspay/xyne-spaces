import type { DmFilterTab } from '@/src/utils/dm-list-filters';

export type DmFilter = DmFilterTab;

export type DmFilterOption = {
  readonly id: DmFilter;
  readonly label: string;
  /**
   * Whether the chip shows how many conversations it would show.
   *
   * Off for All, where the number is the length of the list the user is
   * already looking at and says nothing they cannot see.
   */
  readonly showsCount?: boolean;
};

/**
 * The chips, in display order.
 *
 * The redesign also shows Agents and Drafts. Neither is here yet: both
 * need a predicate `filterDmListItems` cannot express - agent channels
 * are not distinguishable on `DmListItemData`, and a draft lives in
 * the drafts query, not on the row. Adding a chip that silently falls
 * through to `all` would be worse than not shipping it, so they land
 * with their data.
 */
export const DM_FILTERS = [
  {
    id: 'all',
    label: 'All',
  },
  { id: 'unread', label: 'Unread', showsCount: true },
  { id: 'starred', label: 'Starred', showsCount: true },
  { id: 'groups', label: 'Groups', showsCount: true },
] as const satisfies readonly DmFilterOption[];

export const DEFAULT_DM_FILTER: DmFilter = 'all';

/**
 * Whether this chip shows a count.
 *
 * `as const satisfies` keeps the literal shape, so `showsCount` is simply
 * absent from the options that do not declare it and cannot be read off the
 * union directly. Widening once here keeps that out of the view, the same way
 * `parentFlag` does for the flag registry.
 */
export function filterShowsCount(option: DmFilterOption): boolean {
  return option.showsCount === true;
}
