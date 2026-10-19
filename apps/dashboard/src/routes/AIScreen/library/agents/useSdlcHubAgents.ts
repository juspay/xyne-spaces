import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiInstance } from '@/services/clients/apiClient';

export interface SdlcHubAgents {
  memberSlugs: string[];
  pendingSlugs: string[];
  /** The hub's Add members rule, evaluated for the viewer by the server. */
  canAddAgents: boolean;
}

export const sdlcHubAgentsKey = (hubId: string | null): readonly unknown[] => [
  'sdlc-hub-agents',
  hubId,
];

export const useSdlcHubAgents = (hubId: string | null): UseQueryResult<SdlcHubAgents, Error> =>
  useQuery({
    queryKey: sdlcHubAgentsKey(hubId),
    queryFn: async () =>
      (
        await apiInstance.get<SdlcHubAgents>(
          `/sdlc/channels/${encodeURIComponent(hubId ?? '')}/agents`,
        )
      ).data,
    enabled: Boolean(hubId),
  });
