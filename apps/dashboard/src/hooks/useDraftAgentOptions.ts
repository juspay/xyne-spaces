import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAccessibleClawAgents } from '../services/clawAgentListService';
import type { ChannelClawAgent } from './useChannelClawAgents';

export interface DraftAgentOptions {
  /** Channel Claw agents, plus the selected agent when it is not a channel participant. */
  options: ChannelClawAgent[];
  /** The agent matching the selected slug, resolved from either list. */
  selectedAgent: ChannelClawAgent | null;
  /** True while an unknown selected slug is still being looked up. */
  isResolving: boolean;
}

/**
 * Resolves the desk auto-draft agent for display.
 *
 * `useChannelClawAgents` only returns the agents that are participants of the
 * channel, but the "Add agent" picker lets a desk owner choose any Claw agent
 * they can access — and the backend happily drafts with that slug. Resolving
 * the selection against the accessible-agent list (same cache the global agent
 * selector uses) keeps the UI from falling back to the "Xyne AI" default label
 * for an agent that is, in fact, selected and in use.
 */
export const useDraftAgentOptions = (
  clawAgents: ChannelClawAgent[],
  selectedSlug: string | null | undefined,
): DraftAgentOptions => {
  const channelAgent = useMemo(
    () => (selectedSlug ? (clawAgents.find(a => a.slug === selectedSlug) ?? null) : null),
    [clawAgents, selectedSlug],
  );

  // Only hit the list when the selection is not already a channel participant.
  const needsLookup = !!selectedSlug && !channelAgent;

  const { data: accessibleAgents = [], isPending } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 60_000,
    enabled: needsLookup,
  });

  return useMemo(() => {
    if (!selectedSlug) {
      return { options: clawAgents, selectedAgent: null, isResolving: false };
    }
    if (channelAgent) {
      return { options: clawAgents, selectedAgent: channelAgent, isResolving: false };
    }

    const match = accessibleAgents.find(a => a.slug === selectedSlug);
    if (!match) {
      // Unknown slug: either still loading, or the agent was deleted / unshared.
      return { options: clawAgents, selectedAgent: null, isResolving: isPending };
    }

    const resolved: ChannelClawAgent = { slug: match.slug, name: match.name, color: match.color };
    return { options: [...clawAgents, resolved], selectedAgent: resolved, isResolving: false };
  }, [clawAgents, selectedSlug, channelAgent, accessibleAgents, isPending]);
};
