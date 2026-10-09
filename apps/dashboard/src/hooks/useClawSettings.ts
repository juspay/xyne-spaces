import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { getAvailableTools } from '../services/claw/clawToolsService';
import { listSubagentRouting } from '../services/claw/clawSettingsService';
import type { ProviderCredential, SubagentRouting } from '../services/claw/clawSettingsTypes';
import {
  invalidateUserProviderCredentials,
  useUserProviderCredentials,
} from './useUserProviderCredentials';

const FALLBACK_SUBAGENTS = ['spaces', 'bitbucket', 'grafana', 'deepwiki', 'context7', 'pgm'];

export interface ClawSettingsData {
  credentials: ProviderCredential[];
  routing: SubagentRouting[];
  subagents: string[];
}

export interface ClawSettingsResult {
  data: ClawSettingsData | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export const clawSettingsKey = (userId: string | undefined): [string, string | undefined] => [
  'claw-settings',
  userId,
];

export const useClawSettings = (): ClawSettingsResult => {
  const { user } = useAuth();
  const userId = user?.id;
  const credentials = useUserProviderCredentials();

  const rest = useQuery({
    queryKey: clawSettingsKey(userId),
    queryFn: async (): Promise<{ routing: SubagentRouting[]; subagents: string[] }> => {
      const [routing, available] = await Promise.all([
        listSubagentRouting(userId!),
        getAvailableTools().catch(() => null),
      ]);
      const subagents =
        available?.subagents && available.subagents.length > 0
          ? available.subagents.map(subagent => subagent.name)
          : FALLBACK_SUBAGENTS;
      return { routing, subagents };
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  const data =
    credentials.data && rest.data
      ? {
          credentials: credentials.data,
          routing: rest.data.routing,
          subagents: rest.data.subagents,
        }
      : undefined;

  return {
    data,
    isLoading: credentials.isLoading || rest.isLoading,
    isError: credentials.isError || rest.isError,
    error: credentials.error ?? rest.error ?? null,
  };
};

export const invalidateClawSettings = async (
  queryClient: QueryClient,
  userId: string | undefined,
): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: clawSettingsKey(userId) }),
    invalidateUserProviderCredentials(queryClient, userId),
  ]);
};
