import { useValue } from '@legendapp/state/react';
import { useLayoutEffect, useMemo } from 'react';
import { ChannelType, ChannelVisibility, NotificationLevel } from '@xyne/shared';

import {
  getUnreadChannelActivityCounts,
  isUnreadChannelActivity,
} from '@/src/features/activity/domain/activitySelectors';
import {
  DEFAULT_CHANNEL_FILTER,
  getGroupMentionChannelIds,
} from '@/src/components/chat/channel-list/channel-group-preferences';
import { hasNewActivity } from '@/src/components/chat/channel-list/channel-list.utils';
import { useActivityBadgeModel } from '@/src/features/activity/hooks/useActivityBadgeModel';
import { useAuth } from '@/src/contexts/AuthContext';
import { useChannelGroupCollapse } from '@/src/hooks/useChannelGroupCollapse';
import { useChannelGroupPreferences } from '@/src/hooks/useChannelGroupPreferences';
import { useChannelSections } from '@/src/hooks/useChannelSections';
import { groupWorkspaceChannels } from '@/src/hooks/useChannelList';
import { useAllVisibleChannels, useUserChannelStatuses } from '@/src/hooks/useChannels';
import { useUsers } from '@/src/hooks/useUsers';
import { selectSectionableDms } from '@/src/components/chat/channel-list/section-dms';
import { getChannelDisplayName, getDmAvatarUserIds } from '@/src/utils/channel-utils';

import { buildChannelLayout, type ChannelRowData, type ChannelSectionData } from '../model/layout';
import { channelFilter$, setChannelFilterCounts } from '../state/filter-store';
import { syncChannelRows } from '../state/rows-store';

const MENTION_ACTIVITY_ACTIONS = new Set(['mentioned_user', 'group_mention']);

export type ChannelListMeta = {
  isEmpty: boolean;
  isFiltering: boolean;
};

/**
 * Derives the channel list and pushes it into the row store.
 *
 * The badge is the activity-derived count the classic list and the dashboard
 * show. There is no per-message unread counter for channels in the synced data
 * — `channel_user_status.unreadCount` is itself maintained from activities, and
 * plain messages create none for members who were not mentioned. So an unread
 * channel without a count is a real state, and `hasUnread` carries it.
 *
 * `useLayoutEffect` rather than a write during render: the store is external
 * state, and a render-phase write would be visible to a render React later
 * throws away. Layout timing means the rows are in the store before paint.
 */
export function useChannelRows(): ChannelListMeta {
  const filter = useValue(channelFilter$);
  const { user } = useAuth();
  const workspaceId = user?.workspaceId ?? null;
  const currentUserId = user?.user_id ?? '';
  const users = useUsers();

  const visibleChannels = useAllVisibleChannels();
  const userChannelStatuses = useUserChannelStatuses();
  const { unreadActivities } = useActivityBadgeModel();
  const { sections } = useChannelSections();
  const { isChannelsCollapsed } = useChannelGroupCollapse();
  const { channels: channelsPreference } = useChannelGroupPreferences();

  const channels = useMemo<ChannelRowData[]>(() => {
    const statusById = new Map(userChannelStatuses.map(status => [status.channelId, status]));
    const unreadCounts = getUnreadChannelActivityCounts(unreadActivities, statusById);

    const mentioned = new Set<string>();
    for (const activity of unreadActivities ?? []) {
      const channelId = activity?.channelId;
      if (typeof channelId !== 'string' || channelId.length === 0) continue;
      if (typeof activity.actorAction !== 'string') continue;
      if (!MENTION_ACTIVITY_ACTIONS.has(activity.actorAction)) continue;
      if (!isUnreadChannelActivity(activity, statusById.get(channelId)?.lastViewedAt)) continue;
      mentioned.add(channelId);
    }
    const groupMentioned = getGroupMentionChannelIds(unreadActivities);

    const { starred, channels: rest } = groupWorkspaceChannels(
      visibleChannels,
      userChannelStatuses,
    );

    /**
     * Open DMs ride along so a section can show the ones filed into it and the
     * section pickers can offer them, as web does. The layout keeps them out
     * of every other group and out of the filter counts. They use the DMs
     * tab's unread rule: the message counter, unread only when non-zero.
     */
    const usersById = new Map(users.map(entry => [entry.id, entry] as const));
    const dmRows: ChannelRowData[] = selectSectionableDms(visibleChannels, userChannelStatuses).map(
      channel => {
        const status = statusById.get(channel.id);
        const messageUnreadCount = status?.unreadCount ?? 0;
        return {
          id: channel.id,
          name: getChannelDisplayName(channel, currentUserId, usersById),
          isPrivate: false,
          unreadCount: messageUnreadCount,
          messageUnreadCount,
          hasUnread: messageUnreadCount > 0,
          isMentioned: false,
          // A section's Mentions filter and sort read these for DMs as well.
          hasGroupMention: groupMentioned.has(channel.id),
          isMuted: status?.desktopNotificationLevel === NotificationLevel.NONE,
          isStarred: status?.isStarred === true,
          lastActivityAtMs: channel.channelStats?.lastActivityAt ?? 0,
          lastViewedAt: status?.lastViewedAt ?? undefined,
          lastViewedConversationId: status?.lastViewedConversationId ?? undefined,
          sectionId: status?.sectionId ?? null,
          sectionPosition: status?.sectionPosition ?? '',
          isDm: true,
          avatarUserIds: getDmAvatarUserIds(channel, currentUserId),
        };
      },
    );

    const channelRows: ChannelRowData[] = [...starred, ...rest]
      // Only plain channels, as on the dashboard. Email, support, Slack and
      // the other system-managed types live in Desks, not here.
      .filter(channel => channel.type === ChannelType.DEFAULT)
      .map(channel => {
        const status = statusById.get(channel.id);
        const unreadCount = unreadCounts.get(channel.id) ?? 0;
        const lastActivityAtMs = channel.channelStats?.lastActivityAt ?? 0;
        const isMentioned = mentioned.has(channel.id);
        return {
          id: channel.id,
          name: channel.name,
          isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
          unreadCount,
          messageUnreadCount: status?.unreadCount ?? 0,
          // The same test the classic list bolds a row on, plus an unread
          // mention, which the activity feed knows about before the counter.
          hasUnread:
            isMentioned || hasNewActivity(unreadCount, status?.lastViewedAt, lastActivityAtMs),
          isMentioned,
          hasGroupMention: groupMentioned.has(channel.id),
          isMuted: status?.desktopNotificationLevel === NotificationLevel.NONE,
          isStarred: status?.isStarred === true,
          lastActivityAtMs,
          lastViewedAt: status?.lastViewedAt ?? undefined,
          lastViewedConversationId: status?.lastViewedConversationId ?? undefined,
          sectionId: status?.sectionId ?? null,
          sectionPosition: status?.sectionPosition ?? '',
        };
      });

    return [...channelRows, ...dmRows];
  }, [currentUserId, unreadActivities, userChannelStatuses, users, visibleChannels]);

  const sectionData = useMemo<ChannelSectionData[]>(
    () =>
      sections.map(section => ({
        id: section.id,
        name: section.name,
        isCollapsed: section.isCollapsed,
        filterMode: section.filterMode ?? DEFAULT_CHANNEL_FILTER,
        sortOrder: section.sortOrder ?? null,
      })),
    [sections],
  );

  const layout = useMemo(
    () =>
      buildChannelLayout({
        channels,
        sections: sectionData,
        filter,
        isChannelsCollapsed,
        channelsPreference,
        now: Date.now(),
      }),
    [channels, channelsPreference, filter, isChannelsCollapsed, sectionData],
  );

  useLayoutEffect(() => {
    syncChannelRows(channels, layout.groups, sectionData, workspaceId);
  }, [channels, layout.groups, sectionData, workspaceId]);

  // Counts come from the unfiltered list, so they are not a property of the
  // rows the store holds.
  useLayoutEffect(() => {
    setChannelFilterCounts(layout.counts);
  }, [layout.counts]);

  // Empty means nothing to draw: no channels, and no DM sitting in a section.
  const isEmpty = useMemo(
    () =>
      !channels.some(
        channel =>
          channel.isDm !== true ||
          (channel.sectionId !== null && sectionData.some(s => s.id === channel.sectionId)),
      ),
    [channels, sectionData],
  );

  return {
    isEmpty,
    isFiltering: filter !== 'all',
  };
}
