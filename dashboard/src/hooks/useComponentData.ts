import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  fetchComponentData,
  type ComponentDataResponse,
  type ComponentDataError,
} from '../services/DynamicDashboard/componentDataService';

export function useComponentData(
  componentId: string,
  updatedAt: number | undefined,
  autoRefreshMs?: number | null,
): UseQueryResult<ComponentDataResponse, ComponentDataError> {
  return useQuery<ComponentDataResponse, ComponentDataError>({
    queryKey: ['dashboardComponent', componentId, 'data', updatedAt],
    queryFn: ({ signal }) => fetchComponentData(componentId, Boolean(autoRefreshMs), signal),
    enabled: Boolean(componentId),
    staleTime: autoRefreshMs ? 0 : 60 * 1000,
    refetchInterval: autoRefreshMs ?? false,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
