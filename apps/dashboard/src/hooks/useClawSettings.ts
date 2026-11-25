import type { QueryClient } from '@tanstack/react-query';
import type { ProviderCredential } from '../services/claw/clawSettingsTypes';
import {
  invalidateUserProviderCredentials,
  useUserProviderCredentials,
} from './useUserProviderCredentials';

export interface ClawSettingsData {
  credentials: ProviderCredential[];
}

export interface ClawSettingsResult {
  data: ClawSettingsData | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export const useClawSettings = (): ClawSettingsResult => {
  const credentials = useUserProviderCredentials();

  return {
    data: credentials.data ? { credentials: credentials.data } : undefined,
    isLoading: credentials.isLoading,
    isError: credentials.isError,
    error: credentials.error ?? null,
  };
};

export const invalidateClawSettings = async (
  queryClient: QueryClient,
  userId: string | undefined,
): Promise<void> => {
  await invalidateUserProviderCredentials(queryClient, userId);
};
