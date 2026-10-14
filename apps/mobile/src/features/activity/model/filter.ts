import type { ActivityCounts, ActivityTab } from '../domain/activityTypes';

/**
 * The chips.
 *
 * The classic screen has the tabs and, separately, an "unreads only" toggle.
 * The redesign folds the toggle into the row of chips, so a chip is one of
 * three things: All, Unread, or one of the tabs. Each maps back onto the
 * (tab, unread-only) pair the shared screen model already understands, which
 * is what keeps the data layer untouched.
 */
export type ActivityFilter =
  'all' | 'unread' | 'your_mentions' | 'replies' | 'reactions' | 'tickets' | 'group_mentions';

export type ActivityFilterOption = {
  readonly id: ActivityFilter;
  readonly label: string;
  /** The tab this chip shows. */
  readonly tab: ActivityTab;
  /** Whether it narrows that tab to unread activities. */
  readonly unreadOnly: boolean;
};

/**
 * In display order.
 *
 * Actionable and FYI are left out as on the classic screen, which hides them
 * from its tab strip.
 */
export const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All', tab: 'all', unreadOnly: false },
  { id: 'unread', label: 'Unread', tab: 'all', unreadOnly: true },
  { id: 'your_mentions', label: 'Mentions', tab: 'your_mentions', unreadOnly: false },
  { id: 'replies', label: 'Replies', tab: 'replies', unreadOnly: false },
  { id: 'reactions', label: 'Reactions', tab: 'reactions', unreadOnly: false },
  { id: 'tickets', label: 'Tickets', tab: 'tickets', unreadOnly: false },
  { id: 'group_mentions', label: 'Group mentions', tab: 'group_mentions', unreadOnly: false },
] as const satisfies readonly ActivityFilterOption[];

export const DEFAULT_ACTIVITY_FILTER: ActivityFilter = 'all';

export type ActivityFilterCounts = Record<ActivityFilter, number>;

export const EMPTY_ACTIVITY_FILTER_COUNTS: ActivityFilterCounts = {
  all: 0,
  unread: 0,
  ['your_mentions']: 0,
  replies: 0,
  reactions: 0,
  tickets: 0,
  ['group_mentions']: 0,
};

const OPTION_BY_ID = new Map<ActivityFilter, ActivityFilterOption>(
  ACTIVITY_FILTERS.map(option => [option.id, option]),
);

/** The (tab, unread-only) pair a chip stands for. */
export function resolveActivityFilter(filter: ActivityFilter): ActivityFilterOption {
  return OPTION_BY_ID.get(filter) ?? ACTIVITY_FILTERS[0];
}

/**
 * What each chip shows beside its label: how many *unread* activities it
 * would hold. All and Unread therefore carry the same number, which is what
 * the design shows ("All 6", "Unread 6").
 */
export function filterCountsFrom(counts: ActivityCounts): ActivityFilterCounts {
  const next = { ...EMPTY_ACTIVITY_FILTER_COUNTS };
  for (const option of ACTIVITY_FILTERS) {
    next[option.id] = counts[option.tab];
  }
  return next;
}
