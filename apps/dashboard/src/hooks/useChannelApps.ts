import { useQuery } from '@tanstack/react-query';
import { listChannelApps } from '../services/clients/appDeskApi';

export const channelAppsQueryKey = (channelId: string) =>
  ['app-desk-channel-apps', channelId] as const;

/**
 * Apps connected to a desk channel. Any desk type can carry app bindings, so
 * settings that only matter with an app attached gate on this rather than on
 * `ChannelType.APP`.
 */
export function useChannelApps(channelId: string, enabled = true) {
  return useQuery({
    queryKey: channelAppsQueryKey(channelId),
    queryFn: () => listChannelApps(channelId),
    enabled: enabled && !!channelId,
  });
}
