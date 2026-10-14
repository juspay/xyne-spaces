import { ChannelScopeType, type ChannelUserStatus } from '@xyne/shared';
import type { VisibleChannel } from '@xyne/shared/hooks';

import { getUnreadChannelActivityCounts } from '@/src/features/activity/domain/activitySelectors';
import type { ActivityLike } from '@/src/features/activity/domain/activityTypes';
import { groupChannelsByScope, isDMChannel } from '@/src/utils/chatDirectory';

export type TabBadgeCounts = {
  channels: number;
  dms: number;
  activity: number;
};

export type TabBadgeInputs = {
  visibleChannels: readonly VisibleChannel[];
  userChannelStatuses: readonly ChannelUserStatus[];
  unreadActivities: readonly ActivityLike[] | undefined;
  activityCount: number;
};

/**
 * Unread badge counts for the three tabs the bar shows directly.
 *
 * Channels and DMs count *conversations with something unread*, not messages —
 * the same thing each list's own "Unread" filter reports, so the bar and the
 * list it opens never disagree.
 *
 * Kept free of React so the grouping rule below can be tested directly. It has
 * been wrong once already.
 */
export function selectTabBadgeCounts({
  visibleChannels,
  userChannelStatuses,
  unreadActivities,
  activityCount,
}: TabBadgeInputs): TabBadgeCounts {
  const statusByChannelId = new Map(userChannelStatuses.map(status => [status.channelId, status]));
  const channelUnreadCounts = getUnreadChannelActivityCounts(unreadActivities, statusByChannelId);

  /**
   * `groupChannelsByScope` diverts every starred conversation into `starred`
   * before it reaches the section it belongs to, so each section has to take
   * its own back. Miss this on the DM side and a starred DM never counts —
   * which, for anyone who stars the people they talk to, is most of them.
   */
  const { starred, channels, directMessages } = groupChannelsByScope(
    [...visibleChannels],
    [...userChannelStatuses],
  );

  const channelRows = [
    ...starred.filter(channel => channel.scopeType === ChannelScopeType.DEFAULT),
    ...channels,
  ];
  const dmRows = [...starred.filter(channel => isDMChannel(channel.scopeType)), ...directMessages];

  return {
    // Channels track unread through *activity*, DMs through the channel
    // status's own total: the two lists mark themselves read differently, and
    // one rule for both would light a badge its list does not agree with.
    channels: channelRows.reduce(
      (total, channel) => total + ((channelUnreadCounts.get(channel.id) ?? 0) > 0 ? 1 : 0),
      0,
    ),
    dms: dmRows.reduce(
      (total, channel) =>
        total + ((statusByChannelId.get(channel.id)?.unreadCount ?? 0) > 0 ? 1 : 0),
      0,
    ),
    activity: activityCount,
  };
}
