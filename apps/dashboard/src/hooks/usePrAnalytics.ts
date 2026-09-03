import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchBotCommitAnalytics } from '@/services/prAnalyticsService';
import type { BotCommitAnalytics } from '@/services/claw/clawMetricsTypes';
import { useAuth } from './useAuth';

export const useBotCommitAnalytics = (
  days: number,
): UseQueryResult<BotCommitAnalytics, Error> => {
  const { user } = useAuth();
  const workspaceId = user?.workspaceId;

  return useQuery({
    queryKey: ['bot-commit-analytics', workspaceId, days],
    queryFn: () => fetchBotCommitAnalytics(workspaceId!, days),
    enabled: !!workspaceId,
    staleTime: 30000, // 30s - match claw metrics stale time
  });
};
