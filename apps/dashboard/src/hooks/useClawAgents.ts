import { useQuery } from '@tanstack/react-query';
import { fetchAccessibleClawAgents } from '../services/clawAgentListService';

interface CurationAgentOption {
  slug: string;
  name: string;
  color: string;
}

export function useClawAgents(): {
  agents: CurationAgentOption[];
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 60_000,
  });

  const agents = (data ?? [])
    .map(agent => ({
      slug: agent.slug,
      name: agent.name,
      color: agent.color,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { agents, isLoading, isError };
}
