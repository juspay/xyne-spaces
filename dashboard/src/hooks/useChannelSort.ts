import { useMemo } from 'react';
import { ChannelUserStatus, ChannelSortOrder } from '@xyne/shared';
import { useSelector } from '@xstate/react';
import { VisibleChannel } from '../machines/stateMachine';
import { stateMachineActor } from '../machines/stateMachine';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { groupChannelsByScope } from '../components/Chat/ChatDirectory/ChatDirectory.utils';

interface UseChannelSortResult {
  starred: VisibleChannel[];
  channels: VisibleChannel[];
  directMessages: VisibleChannel[];
  allDirectMessages: VisibleChannel[];
  channelSortOrder: ChannelSortOrder;
  setChannelSortOrder: (order: ChannelSortOrder) => void;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const useChannelSort = (
  channelData: VisibleChannel[] | undefined,
  allChannelsUserStatus: ChannelUserStatus[],
  currentUserId: string,
  activeChannelId?: string,
): UseChannelSortResult => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);
  const channelSortOrder = userPreference?.channelSortOrder ?? ChannelSortOrder.RECENCY;

  const setChannelSortOrder = (order: ChannelSortOrder): void => {
    void zero.mutate(
      mutators.userPreference.setChannelSortOrder({
        id: userPreference?.id ?? crypto.randomUUID(),
        channelSortOrder: order,
        timestamp: Date.now(),
      }),
    );
  };

  const { starred, channels, directMessages, allDirectMessages } = useMemo(() => {
    if (!channelData)
      return { starred: [], channels: [], directMessages: [], allDirectMessages: [] };

    const grouped = groupChannelsByScope(channelData, allChannelsUserStatus);

    const sortByActivity = (list: VisibleChannel[]): VisibleChannel[] =>
      [...list].sort(
        (a, b) => (b.channelStats?.lastActivityAt ?? 0) - (a.channelStats?.lastActivityAt ?? 0),
      );

    const sortAlphabetical = (list: VisibleChannel[]): VisibleChannel[] =>
      [...list].sort((a, b) =>
        (a.name ?? '').toLowerCase().localeCompare((b.name ?? '').toLowerCase()),
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

    const sortChannels = (list: VisibleChannel[]): VisibleChannel[] => {
      if (channelSortOrder === ChannelSortOrder.ALPHABETICAL) return sortAlphabetical(list);
      if (channelSortOrder === ChannelSortOrder.UNREAD) return sortByUnreadAndActivity(list);
      return sortByActivity(list);
    };

    // Limit DMs to: active channel, unread, or activity within last 7 days
    const now = Date.now();
    const recentDms = grouped.directMessages.filter(channel => {
      if (channel.id === activeChannelId) return true;
      const status = allChannelsUserStatus.find(
        s => s.channelId === channel.id && s.userId === currentUserId,
      );
      if ((status?.unreadCount ?? 0) > 0) return true;
      const lastActivity = channel.channelStats?.lastActivityAt ?? 0;
      return now - lastActivity < SEVEN_DAYS_MS;
    });

    return {
      starred: sortByUnreadAndActivity(grouped.starred),
      channels: sortChannels(grouped.channels),
      directMessages: sortByUnreadAndActivity(recentDms),
      allDirectMessages: sortByUnreadAndActivity(grouped.directMessages),
    };
  }, [channelData, allChannelsUserStatus, currentUserId, channelSortOrder, activeChannelId]);

  return {
    starred,
    channels,
    directMessages,
    allDirectMessages,
    channelSortOrder,
    setChannelSortOrder,
  };
};
