import {
  ActivityClassification,
  ChannelFilterMode,
  ChannelSortOrder,
  NotificationLevel,
  type ChannelUserStatus,
} from '@xyne/shared';
import type { ActivityLike } from '@/src/features/activity/domain/activityTypes';
import type { VisibleChannel } from '@/src/machines/stateMachine';

export const DEFAULT_CHANNEL_FILTER = ChannelFilterMode.ACTIVE;
export const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export type ChannelGroupPreference = {
  filterMode: ChannelFilterMode;
  sortOrder: ChannelSortOrder | null;
};
export type ChannelGroupContext = {
  statuses: ReadonlyMap<string, ChannelUserStatus>;
  unreadCounts: ReadonlyMap<string, number>;
  mentionedChannelIds: ReadonlySet<string>;
  now: number;
};

/** Filter choices, in the dashboard's order. */
export const CHANNEL_FILTER_OPTIONS: readonly {
  value: ChannelFilterMode;
  label: string;
  description?: string;
}[] = [
  {
    value: ChannelFilterMode.ACTIVE,
    label: 'Active only',
    description: 'New activity within the last 30 days',
  },
  { value: ChannelFilterMode.UNREADS, label: 'Unreads' },
  { value: ChannelFilterMode.MENTIONS, label: 'Mentions' },
  { value: ChannelFilterMode.ALL, label: 'All' },
];

/**
 * Sort choices, in the dashboard's order. `null` is a section's manual order,
 * which only a section offers: the built-in groups have no order of their own.
 */
export const CHANNEL_SORT_OPTIONS: readonly { value: ChannelSortOrder | null; label: string }[] = [
  { value: ChannelSortOrder.UNREAD, label: 'Unread & Activity' },
  { value: ChannelSortOrder.RECENCY, label: 'Recency' },
  { value: ChannelSortOrder.ALPHABETICAL, label: 'Alphabetical A-Z' },
  { value: null, label: 'Manual order' },
];

/** What the dashboard's group filter and sort rules read off one channel. */
export type ChannelGroupFacts = {
  id: string;
  name: string;
  lastActivityAt: number;
  lastViewedAt: number | undefined;
  /** Unread activity counted for the channel — the badge number. */
  unreadActivityCount: number;
  /** The server's own per-channel counter. */
  messageUnreadCount: number;
  /** In the sidebar's wider Mentions set — see `getGroupMentionChannelIds`. */
  isMentioned: boolean;
  /** Notifications turned off for the channel, which keeps it from reading as bold. */
  isMuted: boolean;
};

/**
 * The dashboard's group rules, over any channel shape: filter by
 * `preference.filterMode`, then sort by `preference.sortOrder`. A null sort
 * leaves the filtered items in the order given, which is how a section's
 * manual order survives.
 */
export function arrangeChannelGroup<T>(
  items: readonly T[],
  preference: ChannelGroupPreference,
  factsOf: (item: T) => ChannelGroupFacts,
  now: number,
): T[] {
  const entries = items.map(item => ({ item, facts: factsOf(item) }));
  const isUnseen = ({ lastActivityAt, lastViewedAt }: ChannelGroupFacts): boolean =>
    lastActivityAt > (lastViewedAt ?? 0);

  const filtered = entries.filter(({ facts }) => {
    switch (preference.filterMode) {
      case ChannelFilterMode.ALL:
        return true;
      case ChannelFilterMode.ACTIVE:
        return facts.lastActivityAt >= now - ACTIVE_WINDOW_MS;
      case ChannelFilterMode.MENTIONS:
        return facts.isMentioned;
      case ChannelFilterMode.UNREADS:
        return facts.unreadActivityCount > 0 || isUnseen(facts);
    }
  });
  if (preference.sortOrder === null) return filtered.map(({ item }) => item);

  const tier = (facts: ChannelGroupFacts): number =>
    facts.messageUnreadCount > 0 ? 2 : isUnseen(facts) ? 1 : 0;
  const bold = (facts: ChannelGroupFacts): boolean =>
    !facts.isMuted &&
    (facts.unreadActivityCount > 0 ||
      (!!facts.lastViewedAt && facts.lastActivityAt > facts.lastViewedAt));

  return filtered
    .sort(({ facts: a }, { facts: b }) => {
      if (preference.sortOrder === ChannelSortOrder.ALPHABETICAL) {
        return (
          Number(bold(b)) - Number(bold(a)) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
          a.id.localeCompare(b.id)
        );
      }
      if (preference.sortOrder === ChannelSortOrder.UNREAD) {
        return tier(b) - tier(a) || b.lastActivityAt - a.lastActivityAt;
      }
      return b.lastActivityAt - a.lastActivityAt;
    })
    .map(({ item }) => item);
}

export function applyChannelGroupPreference(
  channels: readonly VisibleChannel[],
  preference: ChannelGroupPreference,
  context: ChannelGroupContext,
): VisibleChannel[] {
  return arrangeChannelGroup(
    channels,
    preference,
    channel => {
      const status = context.statuses.get(channel.id);
      return {
        id: channel.id,
        name: channel.name,
        lastActivityAt: channel.channelStats?.lastActivityAt ?? 0,
        lastViewedAt: status?.lastViewedAt ?? undefined,
        unreadActivityCount: context.unreadCounts.get(channel.id) ?? 0,
        messageUnreadCount: status?.unreadCount ?? 0,
        isMentioned: context.mentionedChannelIds.has(channel.id),
        isMuted: status?.desktopNotificationLevel === NotificationLevel.NONE,
      };
    },
    context.now,
  );
}

// Desktop's sidebar Mentions filter includes keyword matches and followed-thread
// replies, unlike the standalone mobile Mentions tab. Do not exclude thread rows
// or use the channel's last-view timestamp to mark a thread mention as read.
const GROUP_MENTION_ACTIONS = new Set([
  'mentioned_user',
  'group_mention',
  'keyword_match',
  'replied',
  'replied_v2',
]);

export function getGroupMentionChannelIds(
  activities: readonly ActivityLike[] | undefined,
): ReadonlySet<string> {
  return new Set(
    (activities ?? [])
      .filter(
        activity =>
          activity.channelId &&
          !activity.isRead &&
          activity.classification !== ActivityClassification.SKIP &&
          GROUP_MENTION_ACTIONS.has(activity.actorAction ?? ''),
      )
      .map(activity => activity.channelId as string),
  );
}
