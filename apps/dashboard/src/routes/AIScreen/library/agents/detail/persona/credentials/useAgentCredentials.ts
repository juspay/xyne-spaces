import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  deleteAgentProviderCredential,
  listAgentProviderCredentials,
  setAgentProviderCredential,
  type AgentProviderCredentialStatus,
  type SetAgentCredentialPayload,
} from './agentCredentialsService';

export const agentCredentialsKey = (slug: string | undefined): [string, string | undefined] => [
  'claw-agent-provider-credentials',
  slug,
];

export function useAgentCredentials(
  slug: string | undefined,
  enabled = true,
): UseQueryResult<AgentProviderCredentialStatus[], Error> {
  return useQuery({
    queryKey: agentCredentialsKey(slug),
    queryFn: () => listAgentProviderCredentials(slug as string),
    enabled: Boolean(slug) && enabled,
    staleTime: 60 * 1000,
  });
}

export interface AgentCredentialMutations {
  save: (payload: SetAgentCredentialPayload) => Promise<void>;
  remove: (provider: string) => Promise<void>;
  saving: boolean;
  removing: boolean;
}

export function useAgentCredentialMutations(slug: string | undefined): AgentCredentialMutations {
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: agentCredentialsKey(slug) });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: SetAgentCredentialPayload) =>
      setAgentProviderCredential(slug as string, payload),
    onSuccess: () => {
      invalidate();
      toast.success('Credential saved');
    },
    onError: (err: Error) => toast.error(clawErrorText(err, 'Could not save this credential')),
  });

  const removeMutation = useMutation({
    mutationFn: (provider: string) => deleteAgentProviderCredential(slug as string, provider),
    onSuccess: () => {
      invalidate();
      toast.success('Credential removed');
    },
    onError: (err: Error) => toast.error(clawErrorText(err, 'Could not remove this credential')),
  });

  return {
    save: async payload => {
      await saveMutation.mutateAsync(payload).catch(() => undefined);
    },
    remove: async provider => {
      await removeMutation.mutateAsync(provider).catch(() => undefined);
    },
    saving: saveMutation.isPending,
    removing: removeMutation.isPending,
  };
}
