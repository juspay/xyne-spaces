import type { DeskMetricsResponse } from '@xyne/shared';
import { apiInstance } from './clients/apiClient';

export type PerKeyFilter = { values?: string[]; textTerms?: string[] };
export type CustomFieldFilter = {
  keys: string[];
  perKeyFilters?: Record<string, PerKeyFilter>;
};

export async function getDeskMetrics(
  channelId: string,
  timeRange: string,
  assigneeId?: string | null,
  customFieldFilter?: CustomFieldFilter,
): Promise<DeskMetricsResponse> {
  const params: Record<string, string> = { timeRange };
  if (assigneeId) params['assigneeId'] = assigneeId;
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
