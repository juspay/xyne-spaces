import type { PublishReleaseReportResponse } from '@xyne/shared';
import { apiInstance } from './clients/apiClient';

export async function publishReleaseReport(
  ticketId: string,
): Promise<PublishReleaseReportResponse> {
  const response = await apiInstance.post<PublishReleaseReportResponse>(
    `/tickets/${ticketId}/release-report/publish`,
  );
  return response.data;
}
