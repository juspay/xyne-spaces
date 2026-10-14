import { useValue } from '@legendapp/state/react';
import { useLayoutEffect, useMemo } from 'react';
import { ChannelType, ChannelVisibility } from '@xyne/shared';

import {
  getUnreadChannelActivityCounts,
  isUnreadChannelActivity,
} from '@/src/features/activity/domain/activitySelectors';
import { hasNewActivity } from '@/src/components/chat/channel-list/channel-list.utils';
import { useActivityBadgeModel } from '@/src/features/activity/hooks/useActivityBadgeModel';
import { useAuth } from '@/src/contexts/AuthContext';
import { useChannelGroupCollapse } from '@/src/hooks/useChannelGroupCollapse';
import { useChannelSections } from '@/src/hooks/useChannelSections';
import { groupWorkspaceChannels } from '@/src/hooks/useChannelList';
import { useAllVisibleChannels, useUserChannelStatuses } from '@/src/hooks/useChannels';

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

  const visibleChannels = useAllVisibleChannels();
  const userChannelStatuses = useUserChannelStatuses();
  const { unreadActivities } = useActivityBadgeModel();
  const { sections } = useChannelSections();
  const { isChannelsCollapsed } = useChannelGroupCollapse();

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

    const { starred, channels: rest } = groupWorkspaceChannels(
      visibleChannels,
      userChannelStatuses,
    );

    return (
      [...starred, ...rest]
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
            isStarred: status?.isStarred === true,
            lastActivityAtMs,
            lastViewedAt: status?.lastViewedAt ?? undefined,
            lastViewedConversationId: status?.lastViewedConversationId ?? undefined,
            sectionId: status?.sectionId ?? null,
            sectionPosition: status?.sectionPosition ?? '',
          };
        })
    );
  }, [unreadActivities, userChannelStatuses, visibleChannels]);

  const sectionData = useMemo<ChannelSectionData[]>(
    () =>
      sections.map(section => ({
        id: section.id,
        name: section.name,
        isCollapsed: section.isCollapsed,
      })),
    [sections],
  );

  const layout = useMemo(
    () => buildChannelLayout({ channels, sections: sectionData, filter, isChannelsCollapsed }),
    [channels, filter, isChannelsCollapsed, sectionData],
  );

  useLayoutEffect(() => {
    syncChannelRows(channels, layout.groups, sectionData, workspaceId);
  }, [channels, layout.groups, sectionData, workspaceId]);

  // Counts come from the unfiltered list, so they are not a property of the
  // rows the store holds.
  useLayoutEffect(() => {
    setChannelFilterCounts(layout.counts);
  }, [layout.counts]);

  return {
    isEmpty: channels.length === 0,
    isFiltering: filter !== 'all',
  };
}
