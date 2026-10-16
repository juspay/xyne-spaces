import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { SandboxProfileConfig, SdlcSandboxProfileList } from '@xyne/shared';
import { apiInstance } from '@/services/clients/apiClient';

export const SANDBOX_PROFILES_KEY = ['sdlc-sandbox-profiles'] as const;

/** `refreshKey` changes (e.g. the hub's repo ids) refetch it: which repos you can add to depends on them. */
export function useSandboxProfiles(refreshKey?: string): UseQueryResult<SdlcSandboxProfileList> {
  return useQuery({
    queryKey: [...SANDBOX_PROFILES_KEY, refreshKey ?? null],
    queryFn: async () =>
      (await apiInstance.get<SdlcSandboxProfileList>('/sdlc/sandbox-profiles')).data,
  });
}

export function useSandboxTemplates(): UseQueryResult<string[]> {
  return useQuery({
    queryKey: ['sdlc-sandbox-templates'],
    queryFn: async () =>
      (await apiInstance.get<{ templates: string[] }>('/sdlc/sandbox-profiles/templates')).data
        .templates,
    staleTime: 5 * 60_000,
  });
}

export type SaveSandboxProfile =
  | { mode: 'create'; repoId: string; key: string; config: SandboxProfileConfig }
  | { mode: 'update'; key: string; config: SandboxProfileConfig };

export function useSaveSandboxProfile(): UseMutationResult<void, Error, SaveSandboxProfile> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async input => {
      if (input.mode === 'create') {
        await apiInstance.post('/sdlc/sandbox-profiles', {
          repoId: input.repoId,
          key: input.key,
          config: input.config,
        });
      } else {
        await apiInstance.put(`/sdlc/sandbox-profiles/${encodeURIComponent(input.key)}`, {
          config: input.config,
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SANDBOX_PROFILES_KEY });
      // The agent Behaviour tab's sandbox picker reads claw's list.
      void queryClient.invalidateQueries({ queryKey: ['claw-sandbox-repos'] });
    },
  });
}

export function useSetSandboxProfileEnabled(): UseMutationResult<
  void,
  Error,
  { key: string; enabled: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, enabled }) => {
      await apiInstance.post(`/sdlc/sandbox-profiles/${encodeURIComponent(key)}/enabled`, {
        enabled,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SANDBOX_PROFILES_KEY });
      void queryClient.invalidateQueries({ queryKey: ['claw-sandbox-repos'] });
    },
  });
}

/** Built-in only: drop the stored copy so the code version applies again. */
export function useResetSandboxProfile(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async key => {
      await apiInstance.post(`/sdlc/sandbox-profiles/${encodeURIComponent(key)}/reset`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SANDBOX_PROFILES_KEY });
      void queryClient.invalidateQueries({ queryKey: ['claw-sandbox-repos'] });
    },
  });
}
