import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/src/contexts/AuthContext';
import { resolveAccessToken } from '@/src/services/authToken';
import {
  getWorkspaceActivityCounts,
  type WorkspaceNotificationCountItem,
} from '@/src/services/AuthServices';

const WORKSPACE_ACTIVITY_COUNTS_STALE_TIME_MS = 30 * 1000;
const WORKSPACE_ACTIVITY_COUNTS_POLL_INTERVAL_MS = 30 * 1000;

export const workspaceNotificationCountsQueryKey = (memberId: string, workspaceId: string) =>
  ['workspace-activity-counts', memberId, workspaceId] as const;

function buildCountsMap(rows: WorkspaceNotificationCountItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.workspaceId, row.count);
  }
  return map;
}

export function useWorkspaceNotificationCounts(): {
  countsByWorkspaceId: Map<string, number>;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
} {
  const { user, isSignedIn } = useAuth();
  const memberId = user?.memberId ?? '';
  const workspaceId = user?.workspaceId ?? '';
  const enabled = isSignedIn && Boolean(memberId && workspaceId);

  const query = useQuery({
    queryKey: workspaceNotificationCountsQueryKey(memberId, workspaceId),
    queryFn: async () => {
      const resolved = await resolveAccessToken({ preferredWorkspaceId: workspaceId });

      if (!resolved.token) {
        throw new Error('Not authenticated');
      }

      return getWorkspaceActivityCounts(resolved.token);
    },
    staleTime: WORKSPACE_ACTIVITY_COUNTS_STALE_TIME_MS,
    refetchInterval: WORKSPACE_ACTIVITY_COUNTS_POLL_INTERVAL_MS,
    enabled,
  });

  const countsByWorkspaceId = useMemo(() => buildCountsMap(query.data ?? []), [query.data]);

  return {
    countsByWorkspaceId,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
