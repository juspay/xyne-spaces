import type { ActivityCounts, ActivityTab } from '../domain/activityTypes';

/**
 * The chips.
 *
 * A chip is a tab of the shared screen model, one to one. Whether the feed is
 * narrowed to unread activities or to one actor is a separate preference (see
 * `preferences.ts`), exactly as the dashboard separates its tabs from its
 * Unread switch.
 */
export type ActivityFilter = Extract<
  ActivityTab,
  | 'all'
  | 'your_mentions'
  | 'replies'
  | 'reactions'
  | 'tickets'
  | 'group_mentions'
  | 'actionable'
  | 'fyi'
>;

export type ActivityFilterOption = {
  readonly id: ActivityFilter;
  readonly label: string;
  /** Which set of chips it belongs to; All belongs to both. */
  readonly set: 'standard' | 'actionable' | 'both';
};

/** In display order. */
export const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All', set: 'both' },
  { id: 'your_mentions', label: 'Mentions', set: 'standard' },
  { id: 'replies', label: 'Replies', set: 'standard' },
  { id: 'reactions', label: 'Reactions', set: 'standard' },
  { id: 'tickets', label: 'Tickets', set: 'standard' },
  { id: 'group_mentions', label: 'Group mentions', set: 'standard' },
  { id: 'actionable', label: 'Actionable', set: 'actionable' },
  { id: 'fyi', label: 'FYI', set: 'actionable' },
] as const satisfies readonly ActivityFilterOption[];

export const DEFAULT_ACTIVITY_FILTER: ActivityFilter = 'all';

export type ActivityFilterCounts = Record<ActivityFilter, number>;

export const EMPTY_ACTIVITY_FILTER_COUNTS: ActivityFilterCounts = {
  all: 0,
  ['your_mentions']: 0,
  replies: 0,
  reactions: 0,
  tickets: 0,
  ['group_mentions']: 0,
  actionable: 0,
  fyi: 0,
};

/** The chips on show: All plus one of the two sets, as the dashboard does. */
export function visibleActivityFilters(actionable: boolean): readonly ActivityFilterOption[] {
  const wanted = actionable ? 'actionable' : 'standard';
  return ACTIVITY_FILTERS.filter(option => option.set === 'both' || option.set === wanted);
}

/** Whether a chip is in the set currently on show. */
export function isFilterVisible(filter: ActivityFilter, actionable: boolean): boolean {
  return visibleActivityFilters(actionable).some(option => option.id === filter);
}

/** What each chip shows beside its label: how many unread activities it holds. */
export function filterCountsFrom(counts: ActivityCounts): ActivityFilterCounts {
  const next = { ...EMPTY_ACTIVITY_FILTER_COUNTS };
  for (const option of ACTIVITY_FILTERS) {
    next[option.id] = counts[option.id];
  }
  return next;
}
