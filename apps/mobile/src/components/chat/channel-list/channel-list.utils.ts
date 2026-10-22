import type { ChannelListChannelRow } from '@/src/types/channel-list';

export const SEARCH_HIGHLIGHT_CLASS = 'bg-yellow-300 text-yellow-950';

/** @deprecated Prefer `formatCountLabel`; kept so existing imports keep working. */
export { formatCountLabel as formatUnreadLabel } from '@/src/utils/countLabel';

export const hasNewActivity = (
  unreadCount: number,
  lastViewedAt: number | undefined,
  lastActivityAt: number | undefined,
): boolean =>
  unreadCount > 0 || (!!lastViewedAt && !!lastActivityAt && lastActivityAt > lastViewedAt);

export type ChannelListSections = {
  mentions: ChannelListChannelRow[];
  starred: ChannelListChannelRow[];
};

/**
 * `all` is the catch-all pill: every channel, unread ones stacked on top. There
 * is no Unreads pill — that block covers it.
 */
export type ChannelFilterTab = 'all' | 'mentions' | 'starred';

export const CHANNEL_FILTER_TABS: readonly ChannelFilterTab[] = ['all', 'mentions', 'starred'];

const isUnreadChannelRow = (row: ChannelListChannelRow): boolean => {
  const { unreadCount, lastViewedAt, lastActivityAt } = row.data;
  return hasNewActivity(unreadCount, lastViewedAt, lastActivityAt);
};

/**
 * All-channels ordering: every unread channel stacked at the top, then the read
 * ones. Both groups keep the order they arrive in — starred before unstarred,
 * most recent activity first — so this only lifts unreads above read channels.
 */
export const sortChannelRowsByUnread = (
  rows: readonly ChannelListChannelRow[],
): ChannelListChannelRow[] => [
  ...rows.filter(isUnreadChannelRow),
  ...rows.filter(row => !isUnreadChannelRow(row)),
];

/**
 * Answers each pill independently: a pill is a filter over the whole list, not
 * a bucket a channel is assigned to. A starred channel appears under Starred
 * whether or not it is also unread or mentioned.
 *
 * These used to be mutually exclusive, back when they were collapsible
 * sections stacked on one screen and a channel could only live in one of them.
 * That exclusivity outlived the accordions and quietly emptied the Starred
 * pill of every channel with activity — the one place a starred channel is
 * most worth seeing.
 */
export const partitionChannelListRows = (
  starredRows: readonly ChannelListChannelRow[],
  channelRows: readonly ChannelListChannelRow[],
  mentionedChannelIds: ReadonlySet<string>,
): ChannelListSections => ({
  // A mention you have already read is not waiting on you, so Mentions stays
  // scoped to unread ones.
  mentions: [...starredRows, ...channelRows].filter(
    row => isUnreadChannelRow(row) && mentionedChannelIds.has(row.data.id),
  ),
  // Already ordered unread-first by the caller.
  starred: [...starredRows],
});
