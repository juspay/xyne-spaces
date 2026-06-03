import { useEffect, useState } from 'react';
import { apiInstance } from '../services/clients/apiClient';
import { logger, Event } from '../utils/logger';

/**
 * A Claw agent that is a participant of a desk channel and can therefore be
 * picked as the auto-draft generator for that channel.
 */
export interface ChannelClawAgent {
  slug: string;
  name: string;
  color: string;
}

interface ClawAgentsResponse {
  agents: ChannelClawAgent[];
}

/**
 * Returns the Claw agents added to the given channel (its BOT/APP participants).
 * Fetches fresh on every mount / channel change so the dropdown always reflects
 * live channel membership. Empty list on no channel, error, or no agents.
 */
export const useChannelClawAgents = (channelId: string | null | undefined): ChannelClawAgent[] => {
  const [agents, setAgents] = useState<ChannelClawAgent[]>([]);

  useEffect(() => {
    if (!channelId) {
      setAgents([]);
      return;
    }

    let cancelled = false;
    const fetchAndSet = async (): Promise<void> => {
      try {
        const response = await apiInstance.get<ClawAgentsResponse>(
          `/email/${channelId}/claw-agents`,
        );
        if (!cancelled) setAgents(response.data?.agents ?? []);
      } catch (error) {
        // Empty list is the graceful fallback (dropdown shows just Default).
        logger.error(Event.DESK_CLAW_AGENTS_FETCH_FAILED, {
          channelId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        if (!cancelled) setAgents([]);
      }
    };

    void fetchAndSet();
    return (): void => {
      cancelled = true;
    };
  }, [channelId]);

  return agents;
};
