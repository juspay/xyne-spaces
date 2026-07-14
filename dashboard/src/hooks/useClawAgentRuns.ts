import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { listAgentRuns } from '../services/claw/clawRunsService';
import type { AgentRun, AgentRunStatus } from '../services/claw/clawRunsTypes';

export type AgentRunStatusFilter = AgentRunStatus | 'all';

export const useClawAgentRuns = (
  agentSlug: string | undefined,
  options: { status: AgentRunStatusFilter; allUsers: boolean },
): UseQueryResult<AgentRun[], Error> => {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: ['claw-agent-runs', agentSlug, options.status, options.allUsers, userId],
    queryFn: () =>
      listAgentRuns(userId!, agentSlug!, {
        ...(options.status !== 'all' ? { status: options.status } : {}),
        allUsers: options.allUsers,
      }),
    enabled: !!agentSlug && !!userId,
    staleTime: 15 * 1000,
  });
};
