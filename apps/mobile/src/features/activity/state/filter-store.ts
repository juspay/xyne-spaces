import { observable } from '@legendapp/state';

import {
  DEFAULT_ACTIVITY_FILTER,
  EMPTY_ACTIVITY_FILTER_COUNTS,
  type ActivityFilter,
  type ActivityFilterCounts,
} from '../model/filter';

/**
 * Which chip is active. Module-level and not persisted, for the reason the
 * DMs and Channels filters are: a filter is a view, and the chips and the list
 * both need it without either owning the other.
 */
export const activityFilter$ = observable<ActivityFilter>(DEFAULT_ACTIVITY_FILTER);

export function setActivityFilter(filter: ActivityFilter): void {
  activityFilter$.set(filter);
}

/** One subscribable node per chip. */
export const activityFilterCounts$ = observable<ActivityFilterCounts>({
  ...EMPTY_ACTIVITY_FILTER_COUNTS,
});

export function setActivityFilterCounts(counts: ActivityFilterCounts): void {
  activityFilterCounts$.set(counts);
}
