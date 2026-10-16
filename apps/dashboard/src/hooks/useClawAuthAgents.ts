import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { listClawAuthAgents } from '../services/claw/clawAuthAgentsService';
import type { Agent } from '../services/claw/clawAuthAgentTypes';

/** Root of the agent-list key. Invalidate on this alone to reach every user's
 *  list without having to know whose it is. */
export const CLAW_AUTH_AGENTS_KEY = 'claw-auth-agents';

export const clawAuthAgentsKey = (userId: string | undefined): readonly unknown[] => [
  CLAW_AUTH_AGENTS_KEY,
  userId,
];

/**
 * Fetches the agent list from the claw-auth backend for the current user,
 * mirroring what the claw-auth frontend shows. The query is gated on the user
 * id (the internal Spaces id claw-auth expects).
 */
export const useClawAuthAgents = (): UseQueryResult<Agent[], Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: clawAuthAgentsKey(user?.id),
    queryFn: () => listClawAuthAgents(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
};
