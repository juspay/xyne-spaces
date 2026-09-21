import { useQueries } from '@tanstack/react-query';
import type { CredentialHealth } from '@/services/claw/clawSettingsService';
import type { CredentialScope } from './credentialScope';

export interface CredentialHealthMap {
  byProvider: Map<string, CredentialHealth>;
  checking: Set<string>;
}

export const credentialHealthKey = (
  scope: CredentialScope | undefined,
): [string, string | undefined, string | undefined] => [
  'claw-credential-health',
  scope?.kind,
  scope?.id,
];

const providerHealthKey = (
  scope: CredentialScope | undefined,
  provider: string,
): [string, string | undefined, string | undefined, string] => [
  ...credentialHealthKey(scope),
  provider,
];

export function useCredentialHealth(
  scope: CredentialScope | undefined,
  providers: readonly string[],
  enabled: boolean,
): CredentialHealthMap {
  const results = useQueries({
    queries: providers.map(provider => ({
      queryKey: providerHealthKey(scope, provider),
      queryFn: (): Promise<CredentialHealth> => (scope as CredentialScope).verify(provider),
      enabled: Boolean(scope) && enabled,
      retry: false,
      staleTime: 30 * 1000,
    })),
  });

  const byProvider = new Map<string, CredentialHealth>();
  const checking = new Set<string>();

  providers.forEach((provider, index) => {
    const result = results[index];
    if (!result) {
      return;
    }
    if (result.isLoading) {
      checking.add(provider);
      return;
    }
    if (result.data) {
      byProvider.set(provider, result.data);
    }
  });

  return { byProvider, checking };
}
