import { apiInstance } from './clients/apiClient';
import type { BotCommitAnalytics } from './claw/clawMetricsTypes';

export async function fetchBotCommitAnalytics(
  workspaceId: string,
  days: number,
): Promise<BotCommitAnalytics> {
  const response = await apiInstance.get<BotCommitAnalytics>('/analytics/bot-commit-analytics', {
    params: { days },
    headers: {
      'x-workspace-id': workspaceId,
    },
  });
  return response.data;
}
