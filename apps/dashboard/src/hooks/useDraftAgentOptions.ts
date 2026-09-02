import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAccessibleClawAgents } from '../services/clawAgentListService';
import type { ChannelClawAgent } from './useChannelClawAgents';

export interface DraftAgentOptions {
  /** Channel Claw agents, plus the selected agent when it is not a channel participant. */
  options: ChannelClawAgent[];
  selectedAgent: ChannelClawAgent | null;
  /** True while an unknown selected slug is still being looked up. */
  isResolving: boolean;
}

/**
 * Resolves a selected desk agent — auto-draft or desk report — for display.
 *
 * `useChannelClawAgents` only returns agents that are participants of the channel, but
 * "Add agent" lets a desk owner pick any Claw agent they can access, and the backend runs
 * that slug. Resolving against the accessible-agent list (the same cache the global agent
 * selector fills) keeps the UI from showing the built-in default for an agent that is, in
 * fact, selected and in use.
 */
export const useDraftAgentOptions = (
  clawAgents: ChannelClawAgent[],
  selectedSlug: string | null | undefined,
): DraftAgentOptions => {
  const channelAgent = selectedSlug
    ? (clawAgents.find(a => a.slug === selectedSlug) ?? null)
    : null;

  const { data: accessibleAgents = [], isPending } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 60_000,
    // Only look up a selection that is not already a channel participant.
    enabled: !!selectedSlug && !channelAgent,
  });

  return useMemo(() => {
    if (!selectedSlug || channelAgent) {
      return { options: clawAgents, selectedAgent: channelAgent, isResolving: false };
    }
    const match = accessibleAgents.find(a => a.slug === selectedSlug);
    // Unknown slug: either still loading, or the agent was deleted / unshared.
    if (!match) {
      return { options: clawAgents, selectedAgent: null, isResolving: isPending };
    }
    const resolved: ChannelClawAgent = { slug: match.slug, name: match.name, color: match.color };
    return { options: [...clawAgents, resolved], selectedAgent: resolved, isResolving: false };
  }, [clawAgents, selectedSlug, channelAgent, accessibleAgents, isPending]);
};
