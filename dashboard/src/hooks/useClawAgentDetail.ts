import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { getClawAgentDetail, listClawAgentShares } from '../services/claw/clawAuthAgentsService';
import type { Agent, AgentShare } from '../services/claw/clawAuthAgentTypes';

/** Query key for a single agent's detail — exported so mutations can seed/invalidate it. */
export const clawAgentDetailKey = (slug: string | undefined): [string, string | undefined] => [
  'claw-agent-detail',
  slug,
];

/** Fetches a single agent's full detail from claw-auth, keyed by slug. */
export const useClawAgentDetail = (slug: string | undefined): UseQueryResult<Agent, Error> =>
  useQuery({
    queryKey: clawAgentDetailKey(slug),
    queryFn: () => getClawAgentDetail(slug!),
    enabled: !!slug,
    staleTime: 60 * 1000,
  });

/**
 * Fetches the agent's contributor shares for the current user. Needed to derive
 * edit/share permissions on the detail screen.
 */
export const useClawAgentShares = (
  slug: string | undefined,
): UseQueryResult<AgentShare[], Error> => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['claw-agent-shares', slug, user?.id],
    queryFn: () => listClawAgentShares(slug!, user!.id),
    enabled: !!slug && !!user?.id,
    staleTime: 60 * 1000,
  });
};
