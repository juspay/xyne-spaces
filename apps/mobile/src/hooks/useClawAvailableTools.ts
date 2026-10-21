import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getAvailableTools } from '@/src/services/claw/clawToolsService';
import type { AvailableTools } from '@/src/services/claw/clawToolsTypes';

export const CLAW_AVAILABLE_TOOLS_QUERY_KEY = 'claw-available-tools';

export const useClawAvailableTools = (enabled = true): UseQueryResult<AvailableTools, Error> =>
  useQuery({
    queryKey: [CLAW_AVAILABLE_TOOLS_QUERY_KEY],
    queryFn: getAvailableTools,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
