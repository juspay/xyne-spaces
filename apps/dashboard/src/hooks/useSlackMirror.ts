import { useMemo } from 'react';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  getChannelSyncStatus,
  getSlackConnection,
  getSlackSignIn,
  listLinkableSlackChannels,
  listSyncRequests,
  listSyncedChannelIds,
  type ChannelSyncStatus,
  type SlackChannel,
  type SlackConnection,
  type SlackSignInStatus,
  type SyncRequestFilters,
  type SyncRequestRow,
} from '../services/clients/slackMirrorApi';

const FIVE_MINUTES = 5 * 60 * 1000;
const EMPTY_CHANNELS: SlackChannel[] = [];

export const slackMirrorKeys = {
  all: ['slack-mirror'] as const,
  channel: (channelId: string) => ['slack-mirror', 'channel', channelId] as const,
  synced: ['slack-mirror', 'synced'] as const,
  linkable: (channelId: string) => ['slack-mirror', 'linkable', channelId] as const,
  signIn: ['slack-mirror', 'sign-in'] as const,
  requests: (filters: SyncRequestFilters) => ['slack-mirror', 'requests', filters] as const,
  connection: ['slack-mirror', 'connection'] as const,
};

/** The channel card's status; fetched only while the card is on screen. */
export function useChannelSyncStatus(channelId: string): {
  status: ChannelSyncStatus | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: slackMirrorKeys.channel(channelId),
    queryFn: () => getChannelSyncStatus(channelId),
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return { status: data, isLoading };
}

/**
 * Every message box asks whether its channel is synced. They all share one cached list of the
 * user's synced channels, fetched at most every five minutes, instead of a request per channel.
 */
export function useIsChannelSynced(channelId: string | undefined): boolean {
  const { data } = useQuery({
    queryKey: slackMirrorKeys.synced,
    queryFn: listSyncedChannelIds,
    staleTime: FIVE_MINUTES,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const synced = useMemo(() => new Set(data), [data]);
  return !!channelId && synced.has(channelId);
}

/** Slack channels the user and the app share; Slack is asked only when the dropdown opens or on Refresh. */
export function useLinkableSlackChannels(
  channelId: string,
  enabled: boolean,
): {
  channels: SlackChannel[];
  isLoading: boolean;
  isFetching: boolean;
  refresh: () => Promise<unknown>;
} {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: slackMirrorKeys.linkable(channelId),
    queryFn: () => listLinkableSlackChannels(channelId),
    enabled,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return {
    channels: data ?? EMPTY_CHANNELS,
    isLoading: enabled && isLoading,
    isFetching,
    refresh: refetch,
  };
}

export function useSlackSignIn(enabled: boolean): UseQueryResult<SlackSignInStatus> {
  return useQuery({
    queryKey: slackMirrorKeys.signIn,
    queryFn: getSlackSignIn,
    enabled,
    staleTime: FIVE_MINUTES,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSyncRequests(
  filters: SyncRequestFilters,
  enabled: boolean,
): UseQueryResult<{ requests: SyncRequestRow[]; total: number }> {
  return useQuery({
    queryKey: slackMirrorKeys.requests(filters),
    queryFn: () => listSyncRequests(filters),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSlackConnection(enabled: boolean): UseQueryResult<SlackConnection> {
  return useQuery({
    queryKey: slackMirrorKeys.connection,
    queryFn: getSlackConnection,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

interface SlackMirrorRefresh {
  channel: (channelId: string) => Promise<unknown>;
  requests: () => Promise<void>;
  signIn: () => Promise<void>;
  connection: () => Promise<void>;
}

/** After a change, refetch only what it touched. */
export function useRefreshSlackMirror(): SlackMirrorRefresh {
  const queryClient = useQueryClient();
  return {
    channel: channelId =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: slackMirrorKeys.channel(channelId) }),
        queryClient.invalidateQueries({ queryKey: slackMirrorKeys.linkable(channelId) }),
        queryClient.invalidateQueries({ queryKey: slackMirrorKeys.synced }),
      ]),
    requests: () =>
      queryClient.invalidateQueries({ queryKey: [...slackMirrorKeys.all, 'requests'] }),
    signIn: () => queryClient.invalidateQueries({ queryKey: slackMirrorKeys.signIn }),
    connection: () => queryClient.invalidateQueries({ queryKey: slackMirrorKeys.connection }),
  };
}
