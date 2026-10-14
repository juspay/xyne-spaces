export type ChannelFilter = 'all' | 'unread' | 'mentions' | 'starred';

export type ChannelFilterOption = {
  readonly id: ChannelFilter;
  readonly label: string;
  /** Off for All, where the number is the length of the list being viewed. */
  readonly showsCount: boolean;
};

/**
 * The chips, in display order.
 *
 * The design also shows Drafts. It is left out for the reason DMs leaves out
 * its own: a draft lives in the drafts query, not on a channel row, so a chip
 * for it here would filter on nothing. It lands with its data.
 */
export const CHANNEL_FILTERS = [
  { id: 'all', label: 'All', showsCount: false },
  { id: 'unread', label: 'Unread', showsCount: true },
  { id: 'mentions', label: 'Mentions', showsCount: true },
  { id: 'starred', label: 'Starred', showsCount: true },
] as const satisfies readonly ChannelFilterOption[];

export const DEFAULT_CHANNEL_FILTER: ChannelFilter = 'all';

export type ChannelFilterCounts = Readonly<Record<ChannelFilter, number>>;

export const EMPTY_CHANNEL_FILTER_COUNTS: ChannelFilterCounts = {
  all: 0,
  unread: 0,
  mentions: 0,
  starred: 0,
};
