import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { stateMachineActor } from '../machines/stateMachine.js';
import type { Conversation, VisibleChannel } from '../machines/stateMachine.js';
import { queryCacheActor } from '../machines/queryCacheMachine.js';
import { searchChannels as _searchChannels } from '../utils/search.js';
import type { Channel, ChannelUserStatus } from '../zero/schema.js';
import { ChannelScopeType, ChannelVisibility } from '../zero/schema.js';
import { isDeskChannelType } from '../utils/channel.js';
import { queries } from '../zero/queries.js';
import { useQuery } from './useQuery.js';
import { useCachedQuery } from './useCachedQuery';
import type { QueryResultType } from '@rocicorp/zero';

export { type VisibleChannel } from '../machines/stateMachine.js';
export type VisibleProject = QueryResultType<typeof queries.projectsByIds>[number];

// XState assign() preserves context field references when a field is not modified.
// Default useSelector === comparison on the selector output is sufficient and O(1).
// The O(n) shallowEqual comparators were removed — they were comparing 749 channels
// and 431 visible channels on every state machine event, costing ~1s/10s of CPU.

export function searchChannels(channels: Channel[], query: string, limit = 10): Channel[] {
  return _searchChannels(channels, query, limit);
}

export const useAllChannels = (): Channel[] => {
  const channels = useSelector(
    stateMachineActor,
    state => state.context.allChannels,
  );
  const visibleChannels = useSelector(
    stateMachineActor,
    state => state.context.visibleChannels,
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
  );
  return useMemo(() => channels, [channels]);
};

export const useVisibleProjects = (): VisibleProject[] => {
  const channels = useAllVisibleChannels();
  const projectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const channel of channels) {
      if (channel.projectId) ids.add(channel.projectId);
    }
    return Array.from(ids);
  }, [channels]);

  const [projects] = useQuery(
    queries.projectsByIds({ projectIds }),
    { enabled: projectIds.length > 0 },
  );

  return useMemo(
    () => [...(projects ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );
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
      a?.showTicketsTabTicketsInChat === b?.showTicketsTabTicketsInChat,
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
      a?.createdAt === b?.createdAt &&
      a?.showTicketsTabTicketsInChat === b?.showTicketsTabTicketsInChat,
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

export const useEmailChannels = (enabled = true): VisibleChannel[] => {
  const [emailChannelStatuses] = useQuery(queries.userVisibleEmailChannels(), { enabled });
  const allPublicChannels = useAllChannels();
  return useMemo(() => {
    const byId = new Map<string, VisibleChannel>();
    for (const status of emailChannelStatuses ?? []) {
      const ch = status.channel;
      if (ch) byId.set(ch.id, ch as unknown as VisibleChannel);
    }
    for (const channel of allPublicChannels) {
      if (channel.visibility === ChannelVisibility.PRIVATE) continue;
      if (isDeskChannelType(channel.type) && !byId.has(channel.id)) {
        byId.set(channel.id, channel as unknown as VisibleChannel);
      }
    }
    return Array.from(byId.values()).sort((a, b) =>
      (a.name || '').localeCompare(b.name || ''),
    );
  }, [allPublicChannels, emailChannelStatuses]);
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

// Shared Map for O(1) channel user status lookups.
let _cusMapRef: ChannelUserStatus[] | null = null;
let _cusMap = new Map<string, ChannelUserStatus>();

function getChannelUserStatusMap(statuses: ChannelUserStatus[]): Map<string, ChannelUserStatus> {
  if (_cusMapRef !== statuses) {
    _cusMapRef = statuses;
    _cusMap = new Map(statuses.map(s => [s.channelId, s]));
  }
  return _cusMap;
}

export const useGetChannelUserStatus = (channelId: string): ChannelUserStatus | undefined => {
  return useSelector(stateMachineActor, state =>
    getChannelUserStatusMap(state.context.userChannelStatuses).get(channelId),
  );
};

export const useChannelParticipation = (
  channelId: string,
): ChannelUserStatus | undefined => {
  const statusFromHook = useGetChannelUserStatus(channelId);
  const [statusFromQuery] = useCachedQuery(queries.getChannelUserStatus({ channelId }), {
    enabled: statusFromHook === undefined && channelId !== '',
  });
  return statusFromHook ?? statusFromQuery;
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
