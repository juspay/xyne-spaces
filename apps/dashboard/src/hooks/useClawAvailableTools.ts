import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getAvailableTools } from '../services/claw/clawToolsService';
import type { AvailableTools } from '../services/claw/clawToolsTypes';

/**
 * The claw-auth tool catalog (subagents, MCP tools, write tools, custom
 * groups). Cached process-wide — the wizard's Toolbox step mounts it.
 */
export const useClawAvailableTools = (): UseQueryResult<AvailableTools, Error> =>
  useQuery({
    queryKey: ['claw-available-tools'],
    queryFn: getAvailableTools,
    staleTime: 5 * 60 * 1000,
  });
