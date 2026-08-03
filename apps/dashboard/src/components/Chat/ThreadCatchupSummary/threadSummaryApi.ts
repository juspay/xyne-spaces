import { apiInstance } from '../../../services/clients/apiClient';

export interface ThreadSummaryResponse {
  success: boolean;
  content: string;
  cached: boolean;
  asOfMessageId: string;
}

export async function fetchThreadSummary(
  conversationId: string,
): Promise<ThreadSummaryResponse | null> {
  const res = await apiInstance.get<ThreadSummaryResponse>(
    `/conversations/${conversationId}/summary`,
    {
      validateStatus: status => status === 200 || status === 204,
    },
  );
  if (res.status === 204) {
    return null;
  }
  return res.data;
}

interface ThreadRecommendationResponse {
  success: boolean;
  recommended: boolean;
  enabled: boolean;
  summary?: ThreadSummaryResponse;
}

export interface ThreadRecommendationResult {
  recommended: boolean;
  enabled: boolean;
  summary: ThreadSummaryResponse | undefined;
}

export async function fetchThreadRecommendation(
  conversationId: string,
): Promise<ThreadRecommendationResult> {
  const res = await apiInstance.get<ThreadRecommendationResponse>(
    `/conversations/${conversationId}/recommendation`,
  );
  return {
    recommended: res.data.recommended,
    enabled: res.data.enabled,
    summary: res.data.summary,
  };
}
