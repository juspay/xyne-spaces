import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useHttpClient } from './HttpClientContext.js';

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
