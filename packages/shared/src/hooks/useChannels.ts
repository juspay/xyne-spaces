import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { stateMachineActor } from '../machines/stateMachine.js';
import type { Conversation, VisibleChannel } from '../machines/stateMachine.js';
import { queryCacheActor } from '../machines/queryCacheMachine.js';
import { searchChannels as _searchChannels, searchChannelsWithScores as _searchChannelsWithScores } from '../utils/search.js';
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

export function searchChannelsWithScores(channels: Channel[], query: string, limit = 10): { item: Channel; score: number }[] {
  return _searchChannelsWithScores(channels, query, limit);
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
    // Set-based dedup: O(n + m) instead of the previous O(n * m) `combined.some`
    // scan, which cost ~1.7s/recompute over ~749 all + ~431 visible channels.
    const seenIds = new Set(channels.map(c => c.id));
    for (const visibleChannel of visibleChannels) {
      if (!seenIds.has(visibleChannel.id)) {
        seenIds.add(visibleChannel.id);
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

export const useEmailChannels = (): VisibleChannel[] => {
  const userChannelStatuses = useUserChannelStatuses();
  const allPublicChannels = useAllChannels();

  const joinedChannelIds = useMemo(
    () => new Set(userChannelStatuses.filter(s => !s.isClosed && !s.isDeleted).map(s => s.channelId)),
    [userChannelStatuses],
  );

  const channels = useMemo(
    () =>
      allPublicChannels
        .filter(
          c =>
            isDeskChannelType(c.type) &&
            (c.visibility !== ChannelVisibility.PRIVATE || joinedChannelIds.has(c.id)),
        )
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')) as unknown as VisibleChannel[],
    [allPublicChannels, joinedChannelIds],
  );

  const channelIds = useMemo(() => channels.map(c => c.id), [channels]);
  const [channelStats] = useQuery(
    queries.channelStatsByIds({ channelIds }),
    { enabled: channelIds.length > 0 },
  );

  return useMemo(() => {
    if (!channelStats?.length) return channels;
    const statsById = new Map(channelStats.map(s => [s.channelId, s]));
    return channels.map(c => {
      const stats = statsById.get(c.id);
      return stats ? { ...c, channelStats: stats } : c;
    });
  }, [channels, channelStats]);
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

// Stable empty result. An inline `|| []` inside the selector returned a NEW
// array reference on every queryCacheActor event, so every subscriber of a
// channel with no cached conversations re-rendered on every cache event
// (i.e. on every websocket message, app-wide).
const NO_CONVERSATIONS: Conversation[] = [];

/**
 * NON-REACTIVE read of the cached conversations for a channel.
 *
 * Use this for warm-start hydration (e.g. ChatListV3 reads the cache once in
 * a useState initializer). Subscribing via useGetChannelConversations for
 * that purpose created a render echo: ChatListV3 dispatches
 * SET_CONVERSATIONS on every live-query emit → cache updates → subscribing
 * parent re-renders → list re-renders again, doubling the render work for
 * every incoming message.
 *
 * Returns a WINDOW of at most `windowSize` conversations, not the whole
 * cached array — hydrating 1000 conversations meant rendering and
 * height-estimating all of them on mount. Without an anchor, the newest
 * window is returned (channels open at the bottom). With an anchor
 * (deep link / activity click), the window is centered on it; if the anchor
 * is outside the cached range, the newest window is returned and the
 * caller's existing fetch-around-anchor path takes over (its findIndex
 * lookups all guard on -1).
 */
export const getChannelConversationsSnapshot = (
  channelId: string,
  anchorCreatedAt?: number,
  windowSize = 100,
): Conversation[] => {
  const cached =
    queryCacheActor.getSnapshot().context.channelConversations[channelId] || NO_CONVERSATIONS;
  const sorted = [...cached].sort((a, b) => a.createdAt - b.createdAt);

  if (sorted.length <= windowSize) return sorted;

  if (anchorCreatedAt === undefined) {
    return sorted.slice(-windowSize);
  }

  const anchorIdx = sorted.findIndex(c => c.createdAt >= anchorCreatedAt);
  if (anchorIdx === -1) {
    // Anchor is newer than everything cached — newest window contains it.
    return sorted.slice(-windowSize);
  }

  // Center the window on the anchor, clamped to the array bounds.
  const half = Math.floor(windowSize / 2);
  const start = Math.max(0, Math.min(anchorIdx - half, sorted.length - windowSize));
  return sorted.slice(start, start + windowSize);
};

export const useGetChannelConversations = (channelId: string): Conversation[] => {
  const channelConversations = useSelector(
    queryCacheActor,
    state => state.context.channelConversations[channelId] || NO_CONVERSATIONS,
  );
  return useMemo(
    // Sort a copy — `.sort()` mutated the array held inside the actor's
    // context, silently reordering state for every other consumer.
    () => [...channelConversations].sort((a, b) => a.createdAt - b.createdAt),
    [channelConversations],
  );
};

export const useGetLatestConversation = (channelId: string): Conversation | undefined => {
  const channelConversations = useSelector(
    queryCacheActor,
    state => state.context.channelConversations[channelId] || NO_CONVERSATIONS,
  );

  return useMemo(
    () =>
      channelConversations.length === 0
        ? undefined
        : channelConversations.reduce((latest, c) => (c.createdAt > latest.createdAt ? c : latest)),
    [channelConversations],
  );
};
