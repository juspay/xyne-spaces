import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activatePromptVersion, getPromptVersions } from '../services/claw/clawAuthAgentsService';
import { clawAgentDetailKey } from './useClawAgentDetail';

/** Query key for an agent's prompt versions — exported so a prompt save can invalidate it. */
export const clawPromptVersionsKey = (agentSlug: string): [string, string] => [
  'claw-prompt-versions',
  agentSlug,
];

export const useClawPromptVersions = (agentSlug: string, options: { enabled?: boolean } = {}) => {
  const queryClient = useQueryClient();
  const key = clawPromptVersionsKey(agentSlug);
  const query = useQuery({
    queryKey: key,
    queryFn: () => getPromptVersions(agentSlug),
    enabled: options.enabled ?? true,
    staleTime: 30 * 1000,
  });
  const activate = useMutation({
    mutationFn: (version: number) => activatePromptVersion(agentSlug, version),
    onSuccess: updated => {
      queryClient.setQueryData(clawAgentDetailKey(agentSlug), updated);
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
    },
  });
  return { ...query, activate };
};
