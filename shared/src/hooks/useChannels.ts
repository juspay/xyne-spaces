import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { stateMachineActor } from '../machines/stateMachine.js';
import type { Conversation, VisibleChannel } from '../machines/stateMachine.js';
import { queryCacheActor } from '../machines/queryCacheMachine.js';
import { searchChannels as _searchChannels } from '../utils/search.js';
import type { Channel, ChannelUserStatus } from '../zero/schema.js';
import { ChannelScopeType, ChannelType, ChannelVisibility } from '../zero/schema.js';
import { queries } from '../zero/queries.js';
import { useQuery } from './useQuery.js';

export { type VisibleChannel } from '../machines/stateMachine.js';

const shallowEqualVisibleChannels = (a: VisibleChannel[], b: VisibleChannel[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((channel, index) => {
    const otherChannel = b[index];
    return (
      otherChannel &&
      channel.id === otherChannel.id &&
      channel.name === otherChannel.name &&
      channel.scopeType === otherChannel.scopeType &&
      channel.visibility === otherChannel.visibility &&
      channel.channelStats?.lastActivityAt === otherChannel.channelStats?.lastActivityAt &&
      channel.channelStats?.participantCount === otherChannel.channelStats?.participantCount &&
      channel.channelStats?.addUserPolicy === otherChannel.channelStats?.addUserPolicy &&
      channel.description === otherChannel.description
    );
  });
};

const shallowEqualChannels = (a: Channel[], b: Channel[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((channel, index) => {
    const otherChannel = b[index];
    return (
      otherChannel &&
      channel.id === otherChannel.id &&
      channel.name === otherChannel.name &&
      channel.scopeType === otherChannel.scopeType &&
      channel.visibility === otherChannel.visibility
    );
  });
};

export function searchChannels(channels: Channel[], query: string, limit = 10): Channel[] {
  return _searchChannels(channels, query, limit);
}

export const useAllChannels = (): Channel[] => {
  const channels = useSelector(
    stateMachineActor,
    state => state.context.allChannels,
    shallowEqualChannels,
  );
  const visibleChannels = useSelector(
    stateMachineActor,
    state => state.context.visibleChannels,
    shallowEqualVisibleChannels,
  );
  return useMemo(() => {
    const combined = [...channels];
    for (const visibleChannel of visibleChannels) {
      if (!combined.some(c => c.id === visibleChannel.id)) {
        combined.push(visibleChannel);
      }
    }
    return combined;
  }, [channels, visibleChannels]);
};

export const useAllVisibleChannels = (): VisibleChannel[] => {
  const channels = useSelector(
    stateMachineActor,
    state => state.context.visibleChannels,
    shallowEqualVisibleChannels,
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
      a?.createdAt === b?.createdAt,
  );
  const visibleChannel = useSelector(
    stateMachineActor,
    state => state.context.visibleChannels.find(c => c.id === channelId),
    (a, b) =>
      a?.id === b?.id &&
      a?.name === b?.name &&
      a?.scopeType === b?.scopeType &&
      a?.visibility === b?.visibility &&
      a?.description === b?.description &&
      a?.createdAt === b?.createdAt,
  );
  return channel || visibleChannel;
};

export const useVisibleChannel = (channelId: string): VisibleChannel | undefined => {
  const channel = useChannel(channelId);
  const visibleChannels = useAllVisibleChannels();
  const visibleChannel = visibleChannels.find(c => c.id === channelId);
  const [stats] = useQuery(queries.channelStats({ channelId }), { enabled: !visibleChannel });

  return useMemo(() => {
    if (visibleChannel) return visibleChannel;
    if (channel && stats) {
      return {
        ...channel,
        channelStats: stats,
      } as VisibleChannel;
    }
    return undefined;
  }, [channel, stats, visibleChannel]);
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
      a?.createdAt === b?.createdAt,
  );
  const visibleChannel = useSelector(
    stateMachineActor,
    state =>
      state.context.visibleChannels.find(c => c.name.toLowerCase() === channelName.toLowerCase()),
    (a, b) =>
      a?.id === b?.id &&
      a?.name === b?.name &&
      a?.scopeType === b?.scopeType &&
      a?.visibility === b?.visibility &&
      a?.description === b?.description &&
      a?.createdAt === b?.createdAt,
  );

  return channel || visibleChannel;
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

export const useEmailChannels = (): VisibleChannel[] => {
  const channels = useAllVisibleChannels();
  const allPublicChannels = useAllChannels();
  return useMemo(() => {
    // Merge visible channels (participant-scoped) with allPublicChannels
    // (public channels the user may not yet be a participant of) and dedupe
    // by id. Visible wins on conflict so we keep the richer channelStats
    // payload when the same channel appears in both lists; public-only rows
    // are widened to VisibleChannel (channelStats will simply be absent).
    const byId = new Map<string, VisibleChannel>();
    for (const channel of channels) {
      if (channel.type === ChannelType.EMAIL) {
        byId.set(channel.id, channel);
      }
    }
    for (const channel of allPublicChannels) {
      // Visible list already includes the user's private channels; here we
      // only want to surface additional PUBLIC email channels the user hasn't
      // joined yet. Skip PRIVATE ones so we don't leak ones the user isn't in.
      if (channel.visibility === ChannelVisibility.PRIVATE) continue;
      if (channel.type === ChannelType.EMAIL && !byId.has(channel.id)) {
        byId.set(channel.id, channel as unknown as VisibleChannel);
      }
    }
    return Array.from(byId.values()).sort((a, b) =>
      (a.name || '').localeCompare(b.name || ''),
    );
  }, [channels, allPublicChannels]);
};

export const useChannelsByProjectId = (projectId: string | undefined): Channel[] => {
  const channels = useAllChannels();
  return useMemo(() => {
    if (!projectId) return [];
    return channels.filter(channel => channel.projectId === projectId);
  }, [channels, projectId]);
};

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
