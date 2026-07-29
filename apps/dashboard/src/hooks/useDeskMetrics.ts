import { useQuery, UseQueryResult } from '@tanstack/react-query';
import type { DeskMetricsResponse } from '@xyne/shared';
import { getDeskMetrics, type CustomFieldFilter } from '../services/deskMetricsService';

export function useDeskMetrics(
  channelId: string | null,
  timeRange: string,
  enabled: boolean,
  assigneeId?: string | null,
  customFieldFilter?: CustomFieldFilter,
): UseQueryResult<DeskMetricsResponse> {
  return useQuery({
    queryKey: ['desk-metrics', channelId, timeRange, assigneeId ?? null, customFieldFilter ?? null],
    queryFn: () => getDeskMetrics(channelId as string, timeRange, assigneeId, customFieldFilter),
    enabled: enabled && !!channelId,
    retry: 1,
  });
}
