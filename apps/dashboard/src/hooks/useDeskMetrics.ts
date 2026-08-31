import { useQuery, UseQueryResult } from '@tanstack/react-query';
import type {
  DeskMetricsAggregateResponse,
  DeskMetricsResponse,
  TicketPriority,
} from '@xyne/shared';
import {
  getAggregateDeskMetrics,
  getDeskMetrics,
  type CustomFieldFilter,
} from '../services/deskMetricsService';

export function useDeskMetrics(
  channelId: string | null,
  timeRange: string,
  enabled: boolean,
  assigneeIds?: string[],
  customFieldFilter?: CustomFieldFilter,
  stageNames?: string[],
  priorities?: TicketPriority[],
  userGroupIds?: string[],
  tagValues?: string[],
  aiCategories?: string[],
): UseQueryResult<DeskMetricsResponse> {
  const sortedStageNames = [...(stageNames ?? [])].sort();
  const sortedAssigneeIds = [...(assigneeIds ?? [])].sort();
  const sortedPriorities = [...(priorities ?? [])].sort();
  const sortedUserGroupIds = [...(userGroupIds ?? [])].sort();
  const sortedTagValues = [...(tagValues ?? [])].sort();
  const sortedAiCategories = [...(aiCategories ?? [])].sort();
  return useQuery({
    queryKey: [
      'desk-metrics',
      channelId,
      timeRange,
      sortedAssigneeIds,
      customFieldFilter ?? null,
      sortedStageNames,
      sortedPriorities,
      sortedUserGroupIds,
      sortedTagValues,
      sortedAiCategories,
    ],
    queryFn: () =>
      getDeskMetrics(
        channelId as string,
        timeRange,
        sortedAssigneeIds,
        customFieldFilter,
        sortedStageNames,
        sortedPriorities,
        sortedUserGroupIds,
        sortedTagValues,
        sortedAiCategories,
      ),
    enabled: enabled && !!channelId,
    retry: 1,
  });
}

export function useAggregateDeskMetrics(
  channelIds: string[],
  timeRange: string,
  enabled: boolean,
  assigneeIds?: string[],
  customFieldFilter?: CustomFieldFilter,
  stageNames?: string[],
  priorities?: TicketPriority[],
  userGroupIds?: string[],
  tagValues?: string[],
  aiCategories?: string[],
): UseQueryResult<DeskMetricsAggregateResponse> {
  const sortedIds = [...channelIds].sort();
  const sortedAssigneeIds = [...(assigneeIds ?? [])].sort();
  const sortedStageNames = [...(stageNames ?? [])].sort();
  const sortedPriorities = [...(priorities ?? [])].sort();
  const sortedUserGroupIds = [...(userGroupIds ?? [])].sort();
  const sortedTagValues = [...(tagValues ?? [])].sort();
  const sortedAiCategories = [...(aiCategories ?? [])].sort();
  const idsKey = sortedIds.join(',');
  return useQuery({
    queryKey: [
      'desk-metrics-aggregate',
      idsKey,
      timeRange,
      sortedAssigneeIds,
      customFieldFilter ?? null,
      sortedStageNames,
      sortedPriorities,
      sortedUserGroupIds,
      sortedTagValues,
      sortedAiCategories,
    ],
    queryFn: () =>
      getAggregateDeskMetrics(
        sortedIds,
        timeRange,
        sortedAssigneeIds,
        customFieldFilter,
        sortedStageNames,
        sortedPriorities,
        sortedUserGroupIds,
        sortedTagValues,
        sortedAiCategories,
      ),
    enabled: enabled && sortedIds.length > 0,
    retry: 1,
  });
}
