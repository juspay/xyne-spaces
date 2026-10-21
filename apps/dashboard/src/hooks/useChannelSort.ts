import { useMemo } from 'react';
import { ChannelUserStatus, ChannelFilterMode, ChannelSortOrder } from '@xyne/shared';
import { useSelector } from '@xstate/react';
import { VisibleChannel } from '../machines/stateMachine';
import { stateMachineActor } from '../machines/stateMachine';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { useUsersById } from './useUsers';
import { useAllUnreadCount } from './useUnreadCount';
import {
  groupChannelsByScope,
  DEFAULT_FILTER_MODE,
  DEFAULT_GROUP_SORT_ORDER,
  isChannelBold,
  pinSelfDMLast,
  sortChannelsAlphabetically,
} from '../components/Chat/ChatDirectory/ChatDirectory.utils';

export type SidebarGroup = 'starred' | 'channels' | 'dms';

export interface SidebarGroupPreference {
  filterMode: ChannelFilterMode;
  sortOrder: ChannelSortOrder;
}

interface UseChannelSortResult {
  starred: VisibleChannel[];
  channels: VisibleChannel[];
  directMessages: VisibleChannel[];
  channelSortOrder: ChannelSortOrder;
  setChannelSortOrder: (order: ChannelSortOrder) => void;
  groupPreferences: Record<SidebarGroup, SidebarGroupPreference>;
  setGroupPreference: (group: SidebarGroup, patch: Partial<SidebarGroupPreference>) => void;
}

export const useChannelSort = (
  channelData: VisibleChannel[] | undefined,
  allChannelsUserStatus: ChannelUserStatus[],
  currentUserId: string,
): UseChannelSortResult => {
  const zero = useZero();
  const usersById = useUsersById();
  const unreadCounts = useAllUnreadCount();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);
  const channelSortOrder = userPreference?.channelSortOrder ?? ChannelSortOrder.RECENCY;
  const groupPreferences: Record<SidebarGroup, SidebarGroupPreference> = {
    starred: {
      filterMode: userPreference?.starredFilterMode ?? DEFAULT_FILTER_MODE,
      sortOrder: userPreference?.starredSortOrder ?? DEFAULT_GROUP_SORT_ORDER,
    },
    channels: {
      filterMode: userPreference?.channelFilterMode ?? DEFAULT_FILTER_MODE,
      sortOrder: channelSortOrder,
    },
    dms: {
      filterMode: userPreference?.dmFilterMode ?? DEFAULT_FILTER_MODE,
      sortOrder: userPreference?.dmSortOrder ?? DEFAULT_GROUP_SORT_ORDER,
    },
  };

  const setGroupPreference = (
    group: SidebarGroup,
    patch: Partial<SidebarGroupPreference>,
  ): void => {
    void zero.mutate(
      mutators.userPreference.setSidebarGroupPreference({
        id: userPreference?.id ?? crypto.randomUUID(),
        group,
        ...patch,
        timestamp: Date.now(),
      }),
    );
  };

  const setChannelSortOrder = (order: ChannelSortOrder): void => {
    void zero.mutate(
      mutators.userPreference.setChannelSortOrder({
        id: userPreference?.id ?? crypto.randomUUID(),
        channelSortOrder: order,
        timestamp: Date.now(),
      }),
    );
  };

  const starredSortOrder = groupPreferences.starred.sortOrder;
  const dmSortOrder = groupPreferences.dms.sortOrder;

  const { starred, channels, directMessages } = useMemo(() => {
    if (!channelData) return { starred: [], channels: [], directMessages: [] };

    const grouped = groupChannelsByScope(channelData, allChannelsUserStatus);

    const sortByActivity = (list: VisibleChannel[]): VisibleChannel[] =>
      [...list].sort(
        (a, b) => (b.channelStats?.lastActivityAt ?? 0) - (a.channelStats?.lastActivityAt ?? 0),
      );

    const statusByChannelId = new Map(
      allChannelsUserStatus.filter(s => s.userId === currentUserId).map(s => [s.channelId, s]),
    );

    // DM `name` is a comma-joined participant-id list, so sort on the resolved display name.
    // Bold (unread) rows go first, matching what the sidebar renders.
    const sortAlphabetical = (list: VisibleChannel[]): VisibleChannel[] =>
      sortChannelsAlphabetically(list, currentUserId, usersById, c =>
        isChannelBold(c, unreadCounts[c.id] ?? 0, statusByChannelId.get(c.id)),
      );

    const sortByUnreadAndActivity = (list: VisibleChannel[]): VisibleChannel[] => {
      const withUnread: VisibleChannel[] = [];
      const withNewActivity: VisibleChannel[] = [];
      const normal: VisibleChannel[] = [];

      for (const channel of list) {
        const status = allChannelsUserStatus.find(
          s => s.channelId === channel.id && s.userId === currentUserId,
        );
        const unreadCount = status?.unreadCount ?? 0;
        const lastActivityAt = channel.channelStats?.lastActivityAt ?? 0;
        const lastViewedAt = status?.lastViewedAt ?? 0;

        if (unreadCount > 0) {
          withUnread.push(channel);
        } else if (lastActivityAt > lastViewedAt) {
          withNewActivity.push(channel);
        } else {
          normal.push(channel);
        }
      }

      return [
        ...sortByActivity(withUnread),
        ...sortByActivity(withNewActivity),
        ...sortByActivity(normal),
      ];
    };

    const sortBy = (list: VisibleChannel[], order: ChannelSortOrder): VisibleChannel[] => {
      if (order === ChannelSortOrder.ALPHABETICAL) return sortAlphabetical(list);
      if (order === ChannelSortOrder.UNREAD) return sortByUnreadAndActivity(list);
      return sortByActivity(list);
    };

    // Activity cutoffs are the Filter menu's job now — return the full lists.
    return {
      starred: sortBy(grouped.starred, starredSortOrder),
      channels: sortBy(grouped.channels, channelSortOrder),
      // Self-DM always sits at the bottom of the DM list, whatever the sort.
      directMessages: pinSelfDMLast(sortBy(grouped.directMessages, dmSortOrder), currentUserId),
    };
  }, [
    channelData,
    allChannelsUserStatus,
    currentUserId,
    usersById,
    unreadCounts,
    channelSortOrder,
    starredSortOrder,
    dmSortOrder,
  ]);

  return {
    starred,
    channels,
    directMessages,
    channelSortOrder,
    setChannelSortOrder,
    groupPreferences,
    setGroupPreference,
  };
};
