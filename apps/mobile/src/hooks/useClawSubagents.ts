import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listClawSubagents } from '@/src/services/claw/clawSubagentsService';
import type { SubagentDef } from '@/src/services/claw/clawSubagentsTypes';

export const CLAW_SUBAGENTS_QUERY_KEY = 'claw-subagents';

export const useClawSubagents = (
  userId?: string,
  enabled = true,
): UseQueryResult<SubagentDef[], Error> =>
  useQuery({
    queryKey: [CLAW_SUBAGENTS_QUERY_KEY, userId ?? ''],
    queryFn: () => listClawSubagents(userId),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
