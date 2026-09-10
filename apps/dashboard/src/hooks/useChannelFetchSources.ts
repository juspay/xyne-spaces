import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { ChannelFetchSource, getChannelFetchSources } from '../services/clients/deskSourcesApi';

export const channelFetchSourcesQueryKey = (channelId: string) =>
  ['channel-fetch-sources', channelId] as const;

/**
 * Fetchable sources for a desk channel: the email provider (if any) plus one
 * row per connected app. Drives the multi-source fetch picker — any desk type
 * can carry app bindings, so this gates on bindings, not ChannelType.APP.
 */
export function useChannelFetchSources(
  channelId: string | undefined,
  enabled = true,
): UseQueryResult<ChannelFetchSource[], Error> {
  return useQuery({
    queryKey: channelFetchSourcesQueryKey(channelId ?? ''),
    queryFn: () => {
      if (!channelId) throw new Error('channelId required');
      return getChannelFetchSources(channelId);
    },
    enabled: enabled && !!channelId,
    staleTime: 30_000,
    retry: 1,
  });
}
