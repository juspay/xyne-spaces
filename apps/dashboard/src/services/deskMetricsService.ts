import type {
  DeskMetricsAggregateResponse,
  DeskMetricsResponse,
  TicketPriority,
} from '@xyne/shared';
import { apiInstance } from './clients/apiClient';

export type PerKeyFilter = { values?: string[]; textTerms?: string[] };
export type CustomFieldFilter = {
  keys: string[];
  perKeyFilters?: Record<string, PerKeyFilter>;
};

export async function getDeskMetrics(
  channelId: string,
  timeRange: string,
  assigneeIds?: string[],
  customFieldFilter?: CustomFieldFilter,
  stageNames?: string[],
  priorities?: TicketPriority[],
  userGroupIds?: string[],
  tagValues?: string[],
  aiCategories?: string[],
): Promise<DeskMetricsResponse> {
  const params: Record<string, string> = { timeRange };
  if (assigneeIds && assigneeIds.length > 0) params['assigneeIds'] = JSON.stringify(assigneeIds);
  if (stageNames && stageNames.length > 0) params['stageNames'] = JSON.stringify(stageNames);
  if (priorities && priorities.length > 0) params['priorities'] = JSON.stringify(priorities);
  if (userGroupIds && userGroupIds.length > 0)
    params['userGroupIds'] = JSON.stringify(userGroupIds);
  if (tagValues && tagValues.length > 0) params['tagValues'] = JSON.stringify(tagValues);
  if (aiCategories && aiCategories.length > 0)
    params['aiCategories'] = JSON.stringify(aiCategories);
  if (customFieldFilter && customFieldFilter.keys.length > 0) {
    params['customFieldKeys'] = JSON.stringify(customFieldFilter.keys);
    if (customFieldFilter.perKeyFilters)
      params['customFieldPerKeyFilters'] = JSON.stringify(customFieldFilter.perKeyFilters);
  }
  const { data } = await apiInstance.get<DeskMetricsResponse>(`/channels/${channelId}/metrics`, {
    params,
  });
  return data;
}

export async function getAggregateDeskMetrics(
  channelIds: string[],
  timeRange: string,
  assigneeIds?: string[],
  customFieldFilter?: CustomFieldFilter,
  stageNames?: string[],
  priorities?: TicketPriority[],
  userGroupIds?: string[],
  tagValues?: string[],
  aiCategories?: string[],
): Promise<DeskMetricsAggregateResponse> {
  const params: Record<string, string> = {
    timeRange,
    channelIds: channelIds.join(','),
  };
  if (assigneeIds && assigneeIds.length > 0) params['assigneeIds'] = JSON.stringify(assigneeIds);
  if (stageNames && stageNames.length > 0) params['stageNames'] = JSON.stringify(stageNames);
  if (priorities && priorities.length > 0) params['priorities'] = JSON.stringify(priorities);
  if (userGroupIds && userGroupIds.length > 0)
    params['userGroupIds'] = JSON.stringify(userGroupIds);
  if (tagValues && tagValues.length > 0) params['tagValues'] = JSON.stringify(tagValues);
  if (aiCategories && aiCategories.length > 0)
    params['aiCategories'] = JSON.stringify(aiCategories);
  if (customFieldFilter && customFieldFilter.keys.length > 0) {
    params['customFieldKeys'] = JSON.stringify(customFieldFilter.keys);
    if (customFieldFilter.perKeyFilters)
      params['customFieldPerKeyFilters'] = JSON.stringify(customFieldFilter.perKeyFilters);
  }
  const { data } = await apiInstance.get<DeskMetricsAggregateResponse>('/desk-metrics/aggregate', {
    params,
  });
  return data;
}
