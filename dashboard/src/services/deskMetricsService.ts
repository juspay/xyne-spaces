import type { DeskMetricsResponse } from '@xyne/shared';
import { apiInstance } from './clients/apiClient';

export async function getDeskMetrics(
  channelId: string,
  timeRange: string,
  assigneeId?: string | null,
): Promise<DeskMetricsResponse> {
  const params: Record<string, string> = { timeRange };
  if (assigneeId) params['assigneeId'] = assigneeId;
  const { data } = await apiInstance.get<DeskMetricsResponse>(`/channels/${channelId}/metrics`, {
    params,
  });
  return data;
}
