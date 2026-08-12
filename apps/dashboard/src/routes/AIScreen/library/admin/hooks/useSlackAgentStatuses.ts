import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listSlackAgentStatuses } from '@/services/claw/clawSlackService';
import type { SlackAgentStatus } from '@/services/claw/clawSlackTypes';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { slackStatusesKey } from './adminQueryKeys';

export interface SlackStatuses {
  byAgentId: Record<string, SlackAgentStatus>;
  isReady: boolean;
  refresh: () => void;
}

export function useSlackAgentStatuses(userId: string, agents: Agent[] | undefined): SlackStatuses {
  const queryClient = useQueryClient();

  const orgIds = useMemo(
    () =>
      Array.from(
        new Set((agents ?? []).map(agent => agent.orgId).filter((id): id is string => Boolean(id))),
      ).sort(),
    [agents],
  );

  const { data, isFetching } = useQuery({
    queryKey: slackStatusesKey(orgIds),
    queryFn: async () => {
      const results = await Promise.allSettled(
        orgIds.map(orgId => listSlackAgentStatuses(userId, orgId)),
      );
      return results.flatMap(result => (result.status === 'fulfilled' ? result.value : []));
    },
    enabled: Boolean(userId) && orgIds.length > 0,
    retry: false,
    staleTime: 60 * 1000,
  });

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: slackStatusesKey(orgIds) });
  }, [queryClient, orgIds]);

  const byAgentId = useMemo(
    () => Object.fromEntries((data ?? []).map(status => [status.agentId, status])),
    [data],
  );

  return {
    byAgentId,
    isReady: !isFetching,
    refresh,
  };
}
