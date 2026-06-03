import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { QueryVisualizationType } from '@xyne/shared';
import {
  previewQueryPlan,
  type PreviewResponse,
} from '../services/DynamicDashboard/previewService';
import type { ComponentDataError } from '../services/DynamicDashboard/componentDataService';
import {
  resolvePlan,
  type DashboardRuntimeContext,
  type ComponentRuntimeConfig,
} from '../services/DynamicDashboard/planResolver';

export function useResolvedComponentData(args: {
  componentId: string;
  visualType: QueryVisualizationType;
  storedPlan: Record<string, unknown>;
  componentConfig?: ComponentRuntimeConfig | undefined;
  runtimeContext?: DashboardRuntimeContext | null | undefined;
  updatedAt?: number | undefined;
  autoRefreshMs?: number | null | undefined;
  enabled?: boolean | undefined;
}): UseQueryResult<PreviewResponse, ComponentDataError> {
  const {
    componentId,
    visualType,
    storedPlan,
    componentConfig,
    runtimeContext,
    updatedAt,
    autoRefreshMs,
    enabled = true,
  } = args;

  return useQuery<PreviewResponse, ComponentDataError>({
    queryKey: [
      'dashboardComponentResolved',
      componentId,
      visualType,
      updatedAt,
      stableStringify(storedPlan),
      stableStringify(componentConfig ?? {}),
      stableStringify(runtimeContext ?? {}),
    ],
    queryFn: ({ signal }) => {
      const { plan: resolvedPlan } = resolvePlan(storedPlan, runtimeContext, componentConfig);
      return previewQueryPlan(
        {
          plan: resolvedPlan,
          visualType,
          bypassCache: Boolean(autoRefreshMs),
        },
        signal,
      );
    },
    enabled,
    staleTime: autoRefreshMs ? 0 : 60 * 1000,
    refetchInterval: autoRefreshMs ?? false,
    retry: (failureCount, error) => {
      const status = typeof error?.status === 'number' ? error.status : 0;
      if (status >= 400 && status < 500) return false;
      return failureCount < 2;
    },
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = obj[k];
          return acc;
        }, {});
    }
    return v;
  });
}
