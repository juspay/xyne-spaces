import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '../services/clients/apiClient';

type CacConfigResponse<TConfig> = {
  key: string;
  config?: TConfig | null;
};

interface UseCacConfigOptions<TConfig> {
  key: string;
  fallbackConfig: TConfig;
}

export const useCacConfig = <TConfig>({ key, fallbackConfig }: UseCacConfigOptions<TConfig>) => {
  const query = useQuery<CacConfigResponse<TConfig>>({
    queryKey: ['cac-config', key],
    queryFn: async (): Promise<CacConfigResponse<TConfig>> => {
      const response = await apiInstance.get<CacConfigResponse<TConfig>>(`/cac-config/${key}`);
      return response.data;
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  return {
    ...query,
    config: query.data?.config ?? fallbackConfig,
  };
};
