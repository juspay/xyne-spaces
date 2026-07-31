import { useQuery, UseQueryResult } from '@tanstack/react-query';
import type { DeskMetricsAggregateResponse, DeskMetricsResponse } from '@xyne/shared';
import {
  getAggregateDeskMetrics,
  getDeskMetrics,
  type CustomFieldFilter,
} from '../services/deskMetricsService';

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

export function useAggregateDeskMetrics(
  channelIds: string[],
  timeRange: string,
  enabled: boolean,
  assigneeId?: string | null,
  customFieldFilter?: CustomFieldFilter,
): UseQueryResult<DeskMetricsAggregateResponse> {
  const sortedIds = [...channelIds].sort();
  const idsKey = sortedIds.join(',');
  return useQuery({
    queryKey: [
      'desk-metrics-aggregate',
      idsKey,
      timeRange,
      assigneeId ?? null,
      customFieldFilter ?? null,
    ],
    queryFn: () => getAggregateDeskMetrics(sortedIds, timeRange, assigneeId, customFieldFilter),
    enabled: enabled && sortedIds.length > 0,
    retry: 1,
  });
}
