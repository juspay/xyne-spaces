import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { listProviderCredentials } from '../services/claw/clawSettingsService';
import type { ProviderCredential } from '../services/claw/clawSettingsTypes';

export const userProviderCredentialsKey = (
  userId: string | undefined,
): [string, string | undefined] => ['claw-user-provider-credentials', userId];

export const useUserProviderCredentials = (): UseQueryResult<ProviderCredential[], Error> => {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: userProviderCredentialsKey(userId),
    queryFn: () => listProviderCredentials(userId as string),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });
};

export const invalidateUserProviderCredentials = async (
  queryClient: QueryClient,
  userId: string | undefined,
): Promise<void> => {
  await queryClient.invalidateQueries({ queryKey: userProviderCredentialsKey(userId) });
};
