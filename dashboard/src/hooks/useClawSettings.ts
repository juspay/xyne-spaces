import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { getAvailableTools } from '../services/claw/clawToolsService';
import { listProviderCredentials, listSubagentRouting } from '../services/claw/clawSettingsService';
import type { ProviderCredential, SubagentRouting } from '../services/claw/clawSettingsTypes';

const FALLBACK_SUBAGENTS = ['spaces', 'bitbucket', 'grafana', 'deepwiki', 'context7', 'pgm'];

export interface ClawSettingsData {
  credentials: ProviderCredential[];
  routing: SubagentRouting[];
  subagents: string[];
}

export const clawSettingsKey = (userId: string | undefined): [string, string | undefined] => [
  'claw-settings',
  userId,
];

export const useClawSettings = (): UseQueryResult<ClawSettingsData, Error> => {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: clawSettingsKey(userId),
    queryFn: async (): Promise<ClawSettingsData> => {
      const [credentials, routing, available] = await Promise.all([
        listProviderCredentials(userId!),
        listSubagentRouting(userId!),
        getAvailableTools().catch(() => null),
      ]);
      const subagents =
        available?.subagents && available.subagents.length > 0
          ? available.subagents.map(subagent => subagent.name)
          : FALLBACK_SUBAGENTS;
      return { credentials, routing, subagents };
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
};
