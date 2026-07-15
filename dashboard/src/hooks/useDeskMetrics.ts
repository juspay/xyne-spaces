import { useQuery, UseQueryResult } from '@tanstack/react-query';
import type { DeskMetricsResponse } from '@xyne/shared';
import { getDeskMetrics } from '../services/deskMetricsService';

export function useDeskMetrics(
  channelId: string | null,
  timeRange: string,
  enabled: boolean,
  assigneeId?: string | null,
): UseQueryResult<DeskMetricsResponse> {
  return useQuery({
    queryKey: ['desk-metrics', channelId, timeRange, assigneeId ?? null],
    queryFn: () => getDeskMetrics(channelId as string, timeRange, assigneeId),
    enabled: enabled && !!channelId,
    retry: 1,
  });
}
