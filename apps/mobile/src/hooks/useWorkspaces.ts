import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/src/contexts/AuthContext';
import { getValidAccessToken } from '@/src/services/authToken';
import type { WorkspaceItem } from '@/src/services/AuthServices';
import { loadMemberWorkspaces } from '@/src/services/memberWorkspaces';

const WORKSPACES_STALE_TIME_MS = 5 * 60 * 1000;

export const workspacesQueryKey = (memberId: string, workspaceId: string) =>
  ['workspaces', memberId, workspaceId] as const;

export function useWorkspaces(): {
  workspaces: WorkspaceItem[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
} {
  const { user, isSignedIn } = useAuth();
  const memberId = user?.memberId ?? '';
  const workspaceId = user?.workspaceId ?? '';
  const enabled = isSignedIn && Boolean(memberId && workspaceId);

  const query = useQuery({
    queryKey: workspacesQueryKey(memberId, workspaceId),
    queryFn: async () => {
      const accessToken = await getValidAccessToken(300, workspaceId);
      if (!accessToken) {
        throw new Error('Not authenticated');
      }
      // Shared read-through cache: a deep link into another workspace resolves its
      // target from the same list without a second request.
      return loadMemberWorkspaces(accessToken, { force: true });
    },
    staleTime: WORKSPACES_STALE_TIME_MS,
    enabled,
  });

  return {
    workspaces: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
