import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useHttpClient, useOptionalHttpClient } from './HttpClientContext.js';

type CacConfigResponse<TConfig> = {
  key: string;
  config?: TConfig | null;
};

interface UseCacConfigOptions<TConfig> {
  key: string;
  fallbackConfig: TConfig;
}

export const useCacConfig = <TConfig>({
  key,
  fallbackConfig,
}: UseCacConfigOptions<TConfig>): UseQueryResult<CacConfigResponse<TConfig>> & {
  config: TConfig;
} => {
  const httpClient = useHttpClient();
  const query = useQuery<CacConfigResponse<TConfig>>({
    queryKey: ['cac-config', key],
    queryFn: (): Promise<CacConfigResponse<TConfig>> =>
      httpClient.get<CacConfigResponse<TConfig>>(`/cac-config/${key}`),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  return {
    ...query,
    config: query.data?.config ?? fallbackConfig,
  };
};

/**
 * Same as `useCacConfig`, for surfaces that may render without an
 * HttpClientProvider.
 *
 * `useCacConfig` reaches the flag through `useHttpClient`, which throws when no
 * provider is mounted. That is the right default for the dashboard, where a
 * missing provider is a wiring bug. It is wrong for a surface that legitimately
 * has none: dashboard-external mounts only QueryClient and Router (no auth, no
 * Zero — it is served on a public domain) yet reuses FullCallView, so reading a
 * flag there threw during render and React Router showed an error page instead
 * of the call.
 *
 * Here a missing client is not an error, it is simply "no answer" — the same
 * position as a failed request — so the query never starts and the caller gets
 * `fallbackConfig`. Every CAC caller already treats that as "feature off", so
 * such a surface degrades to disabled rather than broken.
 *
 * Prefer `useCacConfig`. Reach for this one only where a provider genuinely may
 * not exist, so that a real wiring bug in the dashboard still fails loudly.
 */
export const useOptionalCacConfig = <TConfig>({
  key,
  fallbackConfig,
}: UseCacConfigOptions<TConfig>): UseQueryResult<CacConfigResponse<TConfig>> & {
  config: TConfig;
} => {
  const httpClient = useOptionalHttpClient();
  const query = useQuery<CacConfigResponse<TConfig>>({
    queryKey: ['cac-config', key],
    // Non-null assertion is safe: `enabled` keeps the fetcher from running while
    // the client is null, and react-query re-evaluates it if one appears later.
    queryFn: (): Promise<CacConfigResponse<TConfig>> =>
      httpClient!.get<CacConfigResponse<TConfig>>(`/cac-config/${key}`),
    enabled: httpClient !== null,
    // Matched to useCacConfig so the two share the ['cac-config', key] cache
    // entry rather than fighting over it with different freshness rules.
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  return {
    ...query,
    config: query.data?.config ?? fallbackConfig,
  };
};
