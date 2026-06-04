/**
 * Frontend service for listing claw agents available in a channel.
 */
import { apiInstance } from './clients/apiClient';

export interface ChannelClawAgent {
  id: string;
  name: string;
  agentSlug: string;
  description: string | null;
}

interface ListChannelClawAgentsResponse {
  agents: ChannelClawAgent[];
}

/**
 * Fetch all claw agents installed in a given channel.
 */
export async function fetchChannelClawAgents(channelId: string): Promise<ChannelClawAgent[]> {
  const response = await apiInstance.get<ListChannelClawAgentsResponse>(
    `/xyne-ai/channel-agents/${channelId}`,
  );
  return response.data.agents;
}
