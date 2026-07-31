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

/**
 * Metrics for a set of desks.
 *
 * A single desk still goes through the aggregate endpoint so the payload shape
 * — and therefore the rendered dashboard — does not change as desks are added
 * or removed: `perDesk` and `skipped` are always present. Ids are sorted in the
 * query key so reordering the same selection is a cache hit rather than a refetch.
 */
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
