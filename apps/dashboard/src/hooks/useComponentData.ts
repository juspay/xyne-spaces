import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  fetchComponentData,
  retryOnServerError,
  type ComponentDataResponse,
  type ComponentDataError,
} from '../services/DynamicDashboard/componentDataService';
import { usePollWhenShown } from './usePageCoverage';

export function useComponentData(
  componentId: string,
  updatedAt: number | undefined,
  autoRefreshMs?: number | null,
): UseQueryResult<ComponentDataResponse, ComponentDataError> {
  const queryKey = ['dashboardComponent', componentId, 'data', updatedAt];
  // Nor, under full-page search, refetched on reconnect: fetched on return if stale by then.
  const shown = usePollWhenShown(queryKey);
  return useQuery<ComponentDataResponse, ComponentDataError>({
    queryKey,
    queryFn: ({ signal }) => fetchComponentData(componentId, Boolean(autoRefreshMs), signal),
    enabled: Boolean(componentId),
    staleTime: autoRefreshMs ? 0 : 60 * 1000,
    refetchInterval: autoRefreshMs
      ? (): number | false => (shown() ? autoRefreshMs : false)
      : false,
    refetchOnReconnect: (): boolean => shown(),
    retry: retryOnServerError,
  });
}
