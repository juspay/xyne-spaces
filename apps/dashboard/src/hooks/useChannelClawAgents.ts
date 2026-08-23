import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '../services/clients/apiClient';

/**
 * A Claw agent that can be picked as the auto-draft generator for a desk channel.
 */
export interface ChannelClawAgent {
  slug: string;
  name: string;
  color: string;
}

interface ClawAgentsResponse {
  agents: ChannelClawAgent[];
}

const CLAW_AGENTS_QUERY_KEY = 'channel-claw-agents';

/**
 * Returns the Claw agents available for the given channel.
 * Uses react-query so subsequent renders/refetches naturally pick up live data.
 * Empty list on no channel, error, or no agents.
 */
export const useChannelClawAgents = (
  channelId: string | null | undefined,
): { agents: ChannelClawAgent[]; refetch: () => void; isLoading: boolean } => {
  const { data, refetch, isLoading } = useQuery({
    queryKey: [CLAW_AGENTS_QUERY_KEY, channelId],
    queryFn: async () => {
      if (!channelId) return [];
      const response = await apiInstance.get<ClawAgentsResponse>(
        `/email/${channelId}/claw-agents`,
      );
      return response.data?.agents ?? [];
    },
    enabled: Boolean(channelId),
    staleTime: 30_000,
  });

  return { agents: data ?? [], refetch, isLoading };
};
