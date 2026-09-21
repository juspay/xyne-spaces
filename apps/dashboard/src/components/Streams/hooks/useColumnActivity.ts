import { useMemo } from 'react';
import { useAllUnreadCount } from '../../../hooks/useUnreadCount';
import { useAllVisibleChannels, useGetChannelUserStatus } from '../../../hooks/useChannels';
import type { ColumnSource } from '../components/Streams/Streams.types';

export interface ColumnActivity {
  /** Things addressed to you: mentions, DMs, assignments. Rendered as a count. */
  count: number;
  /** Something moved here that is not addressed to you. Rendered as a dot. */
  hasNew: boolean;
}

/** Nothing to report. Shared so every caller compares against one object. */
export const IDLE: ColumnActivity = { count: 0, hasNew: false };

/**
 * Does this column want you at all — either tier.
 *
 * A named predicate because the expression was written out at seven call sites
 * and the eighth got it wrong: the top nav's tab tested `hasNew` alone, so a
 * column with three mentions rendered its title thin and grey while a column
 * where somebody said "morning" rendered bold. Mentions are the *stronger*
 * tier; a reading of unread that excludes them is backwards.
 *
 * The tiers still differ in how they are *drawn* — a count gets a number, a
 * `hasNew` gets a dot. This is only the question of whether there is anything
 * to draw.
 */
export const isUnread = (activity: ColumnActivity): boolean =>
  activity.count > 0 || activity.hasNew;

/**
 * What is new in a column, in the two tiers the rest of Xyne already uses.
 *
 * The sidebar makes exactly this distinction and it is worth matching rather
 * than inventing a third vocabulary: a **numeric badge** for things addressed to
 * you (mentions, DMs — `useAllUnreadCount`), and **bold** for a channel whose
 * `lastActivityAt` is newer than your `lastViewedAt`, meaning something happened
 * but nobody asked for you. Streams renders the second tier as a dot instead of
 * bold, because a column header has no name weight to change.
 *
 * Muted channels contribute no ambient signal, matching the sidebar: muting is a
 * statement about attention, and it should hold in a monitoring view most of all.
 */
export const useColumnActivity = (source: ColumnSource): ColumnActivity => {
  const unreadCounts = useAllUnreadCount();

  const channelId = source.kind === 'channel' ? source.channelId : '';
  // `useChannel` returns the bare row; `lastActivityAt` lives on the related
  // `channelStats`, which only the visible-channels query pulls in — the same
  // source the sidebar reads for exactly this comparison.
  const visibleChannels = useAllVisibleChannels();
  const channel = useMemo(
    () => visibleChannels.find(candidate => candidate.id === channelId),
    [visibleChannels, channelId],
  );
  const status = useGetChannelUserStatus(channelId);

  if (source.kind !== 'channel' || !channelId) return IDLE;

  const count = unreadCounts[channelId] ?? 0;
  const lastActivityAt = channel?.channelStats?.lastActivityAt;
  const lastViewedAt = status?.lastViewedAt;
  const moved = Boolean(lastActivityAt && lastViewedAt && lastActivityAt > lastViewedAt);

  return { count, hasNew: count === 0 && moved };
};
