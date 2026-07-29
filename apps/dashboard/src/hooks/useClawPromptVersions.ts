import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activatePromptVersion, getPromptVersions } from '../services/claw/clawAuthAgentsService';
import { clawAgentDetailKey } from './useClawAgentDetail';

export const useClawPromptVersions = (agentSlug: string) => {
  const queryClient = useQueryClient();
  const key = ['claw-prompt-versions', agentSlug];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getPromptVersions(agentSlug),
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
