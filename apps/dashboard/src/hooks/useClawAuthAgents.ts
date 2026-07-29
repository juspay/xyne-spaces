import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { listClawAuthAgents } from '../services/claw/clawAuthAgentsService';
import type { Agent } from '../services/claw/clawAuthAgentTypes';

/**
 * Fetches the agent list from the claw-auth backend for the current user,
 * mirroring what the claw-auth frontend shows. The query is gated on the user
 * id (the internal Spaces id claw-auth expects).
 */
export const useClawAuthAgents = (): UseQueryResult<Agent[], Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['claw-auth-agents', user?.id],
    queryFn: () => listClawAuthAgents(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
};
