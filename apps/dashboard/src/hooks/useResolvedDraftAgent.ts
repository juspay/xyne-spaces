import { useQuery } from '@tanstack/react-query';
import { fetchAccessibleClawAgents } from '../services/clawAgentListService';
import type { ChannelClawAgent } from './useChannelClawAgents';

export interface ResolvedDraftAgent {
  slug: string;
  name: string;
  color: string;
}

/**
 * Resolve the display identity (name + color) of the selected auto-draft agent.
 *
 * The draft agent slug saved on a desk can point at ANY Claw agent the user can
 * access — the "Add agent" modal lists the full accessible-agents catalogue
 * (`/xyne-ai/agents`), not just the agents that are participants of this
 * channel. `clawAgents` only ever contains channel participants, so an agent
 * picked from the modal — or restored from a saved preference after a reload —
 * is absent from it. When the picker could not find a matching option it fell
 * back to the "Default (Xyne AI)" placeholder even though a real agent was
 * selected and saved.
 *
 * This resolves the slug against the channel agents first (no fetch needed) and
 * falls back to the full accessible-agents list so the real agent name/color is
 * always shown. Returns null only for the default (null slug) or a slug that is
 * genuinely no longer accessible (deleted / access revoked) — the caller can use
 * that to show the "falls back to default" hint.
 *
 * The accessible-agents query shares its cache key with `AddAgentModal`, so no
 * extra network request is made when the modal has already loaded the list.
 */
export const useResolvedDraftAgent = (
  slug: string | null | undefined,
  clawAgents: ChannelClawAgent[],
): ResolvedDraftAgent | null => {
  const inChannel = slug ? (clawAgents.find(a => a.slug === slug) ?? null) : null;

  const { data: accessibleAgents = [] } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 60_000,
    // Only hit the network when the slug isn't already a known channel agent.
    enabled: !!slug && !inChannel,
  });

  if (!slug) return null;
  if (inChannel) return inChannel;

  const external = accessibleAgents.find(a => a.slug === slug);
  return external ? { slug: external.slug, name: external.name, color: external.color } : null;
};
