import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { Conversation, stateMachineActor, type Channel } from '../machines/stateMachine';
import Fuse from 'fuse.js';
import { ChannelScopeType, ChannelType, ChannelUserStatus } from '@xyne/shared';
import { queryCacheActor } from '../machines/queryCacheMachine';

const shallowEqualChannels = (a: Channel[], b: Channel[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((channel, index) => {
    const otherChannel = b[index];
    return (
      otherChannel &&
      channel.id === otherChannel.id &&
      channel.name === otherChannel.name &&
      channel.scopeType === otherChannel.scopeType &&
      channel.visibility === otherChannel.visibility &&
      channel.lastActivityAt === otherChannel.lastActivityAt
    );
  });
};

export function searchChannels(channels: Channel[], query: string, limit = 10): Channel[] {
  if (!query.trim()) return channels.slice(0, limit);

  const q = query.toLowerCase();

  const fuse = new Fuse(channels, {
    keys: ['name'],
    threshold: 0.3,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
    isCaseSensitive: false,
  });

  const results = fuse.search(query);

  const rescored = results.map(r => {
    const name = r.item.name.toLowerCase();
    let finalScore = r.score ?? 1;

    if (name.startsWith(q)) {
      finalScore -= 10;
    } else if (name.includes(' ' + q)) {
      finalScore -= 5;
    }

    return {
      item: r.item,
      score: finalScore,
    };
  });

  return rescored
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      return a.item.name.localeCompare(b.item.name);
    })
    .slice(0, limit)
    .map(r => r.item);
}

export const useAllChannels = (): Channel[] => {
  const channels = useSelector(
    stateMachineActor,
    state => state.context.allChannels,
    shallowEqualChannels,
  );
  return useMemo(() => channels, [channels]);
};

export const useAllVisibleChannels = (): Channel[] => {
  const channels = useSelector(
    stateMachineActor,
    state => state.context.visibleChannels,
    shallowEqualChannels,
  );
  return useMemo(() => channels, [channels]);
};

export const useChannel = (channelId: string): Channel | undefined => {
  const channel = useSelector(
    stateMachineActor,
    state => state.context.allChannels.find(c => c.id === channelId),
    (a, b) =>
      a?.id === b?.id &&
      a?.name === b?.name &&
      a?.scopeType === b?.scopeType &&
      a?.visibility === b?.visibility &&
      a?.description === b?.description &&
      a?.createdAt === b?.createdAt &&
      a?.participantCount === b?.participantCount,
  );

  return channel;
};

export const useChannelByName = (channelName: string): Channel | undefined => {
  const channel = useSelector(
    stateMachineActor,
    state =>
      state.context.allChannels.find(c => c.name.toLowerCase() === channelName.toLowerCase()),
    (a, b) =>
      a?.id === b?.id &&
      a?.name === b?.name &&
      a?.scopeType === b?.scopeType &&
      a?.visibility === b?.visibility &&
      a?.description === b?.description &&
      a?.createdAt === b?.createdAt &&
      a?.participantCount === b?.participantCount,
  );

  return channel;
};

export const useChannelSearch = (query: string, limit: number): Channel[] => {
  const channels = useAllChannels();
  return useMemo(() => searchChannels(channels, query, limit), [channels, query, limit]);
};

export const useBrowsableChannels = (): Channel[] => {
  const channels = useAllChannels();
  return useMemo(() => {
    return channels
      .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [channels]);
};

export const useMigratedChannels = (): Channel[] => {
  const channels = useAllChannels();
  return useMemo(() => {
    if (!channels?.length) return [];
    return channels.filter(channel => channel.isMigrated);
  }, [channels]);
};

// Hook to get EMAIL type channels (for Xyne Desk / external sources)
export const useEmailChannels = (): Channel[] => {
  const channels = useAllChannels();
  return useMemo(() => {
    if (!channels?.length) return [];
    return channels
      .filter(channel => channel.type === ChannelType.EMAIL)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [channels]);
};

export const useChannelsByProjectId = (projectId: string | undefined): Channel[] => {
  const channels = useAllChannels();
  return useMemo(() => {
    if (!projectId) return [];
    return channels.filter(channel => channel.projectId === projectId);
  }, [channels, projectId]);
};

// Channel user status hooks

export const useUserChannelStatuses = (): ChannelUserStatus[] => {
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );
  return useMemo(() => userChannelStatuses, [userChannelStatuses]);
};

export const useGetChannelUserStatus = (channelId: string): ChannelUserStatus | undefined => {
  const channelUserStatus = useSelector(stateMachineActor, state =>
    state.context.userChannelStatuses.find(c => c.channelId === channelId),
  );
  return channelUserStatus;
};

// Hook to calculate unread counts for channels
export const useUnreadChannelCounts = (channels: Channel[] | undefined): Record<string, number> => {
  const userChannelStatuses = useUserChannelStatuses();

  return useMemo(() => {
    const counts: Record<string, number> = {};
    if (!channels || !userChannelStatuses) return counts;

    const statusMap = new Map(userChannelStatuses.map(s => [s.channelId, s]));

    channels.forEach(channel => {
      const status = statusMap.get(channel.id);

      if (status && channel.lastActivityAt && channel.lastActivityAt > status.lastViewedAt) {
        counts[channel.id] = 1; // Return 1 for unread (for bold styling)
      } else {
        counts[channel.id] = 0;
      }
    });

    return counts;
  }, [channels, userChannelStatuses]);
};

export const useGetChannelConversations = (channelId: string): Conversation[] => {
  const channelConversations = useSelector(
    queryCacheActor,
    state => state.context.channelConversations[channelId] || [],
  );
  return useMemo(
    () => channelConversations.sort((a, b) => a.createdAt - b.createdAt),
    [channelConversations],
  );
};

export const useGetLatestConversation = (channelId: string): Conversation | undefined => {
  const channelConversations = useSelector(
    queryCacheActor,
    state => state.context.channelConversations[channelId] || [],
  );

  return useMemo(
    () => channelConversations.sort((a, b) => b.createdAt - a.createdAt)[0],
    [channelConversations],
  );
};
