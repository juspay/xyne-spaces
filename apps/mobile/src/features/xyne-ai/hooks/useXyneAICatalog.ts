import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  fetchAgents,
  fetchConfig,
  fetchModels,
  type XyneAIAgent,
  type XyneAIConfig,
  type XyneAIModels,
} from '../api/xyneAICatalog';

const STALE_TIME_MS = 5 * 60_000;

export const useXyneAIAgents = (): UseQueryResult<XyneAIAgent[]> =>
  useQuery({ queryKey: ['xyne-ai', 'agents'], queryFn: fetchAgents, staleTime: STALE_TIME_MS });

export const useXyneAIModels = (agentSlug: string): UseQueryResult<XyneAIModels> =>
  useQuery({
    queryKey: ['xyne-ai', 'models', agentSlug],
    queryFn: () => fetchModels(agentSlug),
    staleTime: STALE_TIME_MS,
  });

export const useXyneAIConfig = (): UseQueryResult<XyneAIConfig> =>
  useQuery({ queryKey: ['xyne-ai', 'config'], queryFn: fetchConfig, staleTime: STALE_TIME_MS });
