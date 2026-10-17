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

export function applyChannelGroupPreference(
  channels: readonly VisibleChannel[],
  preference: ChannelGroupPreference,
  context: ChannelGroupContext,
): VisibleChannel[] {
  const activity = (channel: VisibleChannel): number => channel.channelStats?.lastActivityAt ?? 0;
  const status = (channel: VisibleChannel): ChannelUserStatus | undefined =>
    context.statuses.get(channel.id);
  const filtered = channels.filter(channel => {
    switch (preference.filterMode) {
      case ChannelFilterMode.ALL:
        return true;
      case ChannelFilterMode.ACTIVE:
        return activity(channel) >= context.now - ACTIVE_WINDOW_MS;
      case ChannelFilterMode.MENTIONS:
        return context.mentionedChannelIds.has(channel.id);
      case ChannelFilterMode.UNREADS:
        return (
          (context.unreadCounts.get(channel.id) ?? 0) > 0 ||
          activity(channel) > (status(channel)?.lastViewedAt ?? 0)
        );
    }
  });
  if (preference.sortOrder === null) return filtered;
  const tier = (channel: VisibleChannel): number =>
    (status(channel)?.unreadCount ?? 0) > 0
      ? 2
      : activity(channel) > (status(channel)?.lastViewedAt ?? 0)
        ? 1
        : 0;
  const bold = (channel: VisibleChannel): boolean => {
    const viewed = status(channel)?.lastViewedAt;
    return (
      status(channel)?.desktopNotificationLevel !== NotificationLevel.NONE &&
      ((context.unreadCounts.get(channel.id) ?? 0) > 0 || (!!viewed && activity(channel) > viewed))
    );
  };
  return filtered.sort((a, b) => {
    if (preference.sortOrder === ChannelSortOrder.ALPHABETICAL) {
      return (
        Number(bold(b)) - Number(bold(a)) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id)
      );
    }
    if (preference.sortOrder === ChannelSortOrder.UNREAD) {
      return tier(b) - tier(a) || activity(b) - activity(a);
    }
    return activity(b) - activity(a);
  });
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
