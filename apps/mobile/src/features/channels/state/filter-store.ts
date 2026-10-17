import { observable } from '@legendapp/state';

import {
  DEFAULT_CHANNEL_FILTER,
  EMPTY_CHANNEL_FILTER_COUNTS,
  type ChannelFilter,
  type ChannelFilterCounts,
} from '../model/filter';

/**
 * Which chip is active.
 *
 * Module-level for the reason the DMs filter is: the screen stays mounted
 * across tab switches, and the chips and the list both need it without either
 * owning the other. Not persisted — a filter is a view, not a preference.
 */
export const channelFilter$ = observable<ChannelFilter>(DEFAULT_CHANNEL_FILTER);

export function setChannelFilter(filter: ChannelFilter): void {
  channelFilter$.set(filter);
}

/** How many channels each chip would show, one subscribable node per chip. */
export const channelFilterCounts$ = observable<ChannelFilterCounts>({
  ...EMPTY_CHANNEL_FILTER_COUNTS,
});

export function setChannelFilterCounts(counts: ChannelFilterCounts): void {
  channelFilterCounts$.set(counts);
}
