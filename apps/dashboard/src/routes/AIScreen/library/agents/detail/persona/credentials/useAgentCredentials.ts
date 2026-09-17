import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  type AgentProviderCredentialStatus,
  type SetAgentCredentialPayload,
} from './agentCredentialsService';
import type { CredentialScope } from './credentialScope';
import { credentialHealthKey } from './useCredentialHealth';

/** Keyed by scope kind + id so agent and user caches never collide. */
export const agentCredentialsKey = (
  scope: CredentialScope | undefined,
): [string, string | undefined, string | undefined] => [
  'claw-provider-credentials',
  scope?.kind,
  scope?.id,
];

export function useAgentCredentials(
  scope: CredentialScope | undefined,
  enabled = true,
): UseQueryResult<AgentProviderCredentialStatus[], Error> {
  return useQuery({
    queryKey: agentCredentialsKey(scope),
    queryFn: () => (scope as CredentialScope).list(),
    enabled: Boolean(scope) && enabled,
    staleTime: 60 * 1000,
  });
}

export interface AgentCredentialMutations {
  /** Resolves to the failure message, or null when the credential was saved. */
  save: (payload: SetAgentCredentialPayload) => Promise<string | null>;
  remove: (provider: string) => Promise<void>;
  saving: boolean;
  removing: boolean;
}

export function useAgentCredentialMutations(
  scope: CredentialScope | undefined,
): AgentCredentialMutations {
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: agentCredentialsKey(scope) });
    void queryClient.invalidateQueries({ queryKey: credentialHealthKey(scope) });
    void queryClient.invalidateQueries({ queryKey: ['claw-provider-models'] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: SetAgentCredentialPayload) => (scope as CredentialScope).set(payload),
    onSuccess: () => {
      invalidate();
      toast.success('Credential verified and saved');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (provider: string) => (scope as CredentialScope).remove(provider),
    onSuccess: () => {
      invalidate();
      toast.success('Credential removed');
    },
    onError: (err: Error) => toast.error(clawErrorText(err, 'Could not remove this credential')),
  });

  return {
    save: async payload => {
      try {
        await saveMutation.mutateAsync(payload);
        return null;
      } catch (err) {
        return clawErrorText(err, 'Could not save this credential');
      }
    },
    remove: async provider => {
      await removeMutation.mutateAsync(provider).catch(() => undefined);
    },
    saving: saveMutation.isPending,
    removing: removeMutation.isPending,
  };
}
