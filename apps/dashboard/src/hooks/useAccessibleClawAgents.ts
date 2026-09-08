/**
 * Shared access to the user's accessible claw agents, cached under the
 * ['accessible-claw-agents'] key (same key the composer's AIAgentSelector uses,
 * so the list is fetched once and shared). Exposes a slug → agent lookup for
 * rendering agent chips on the consolidated recents / search rows.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchAccessibleClawAgents,
  type AccessibleClawAgent,
} from '../services/clawAgentListService';

export function useAccessibleClawAgents(): {
  agents: AccessibleClawAgent[];
  agentBySlug: Map<string, AccessibleClawAgent>;
  isLoading: boolean;
} {
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 5 * 60 * 1000,
  });

  const agentBySlug = useMemo(() => {
    const map = new Map<string, AccessibleClawAgent>();
    for (const a of agents) map.set(a.slug, a);
    return map;
  }, [agents]);

  return { agents, agentBySlug, isLoading };
}
