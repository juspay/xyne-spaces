import { ReactElement, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { apiInstance } from '../../services/clients/apiClient';

interface CommunityWorkspacesResponse {
  organizations: { workspaces: { id: string }[] }[];
}

type LinkKind = 'loading' | 'community' | 'enterprise';

/**
 * Entry point for `/community/join?workspaceId=...`, used by the top bar
 * "Copy invite link" button (COMMUNITY workspaces). Approval emails sent before
 * enterprise workspaces got their own `/enterprise/join` link also point here.
 *
 * `/community/workspaces` is public and lists only COMMUNITY workspaces, so we
 * use it to tell the two apart before the user has signed in.
 *
 * - Community: hand off to /auth?workspaceId=..., which stores it as the pending
 *   community workspace and joins it after sign-in.
 * - Anything else: hand off to /enterprise/join.
 */
export const CommunityJoinRoute = (): ReactElement | null => {
  const [searchParams] = useSearchParams();
  const workspaceId = searchParams.get('workspaceId')?.trim();
  const [kind, setKind] = useState<LinkKind>('loading');

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    apiInstance
      .get<CommunityWorkspacesResponse>('/community/workspaces')
      .then(response => {
        if (cancelled) return;
        const isCommunity = (response.data.organizations || [])
          .flatMap(org => org.workspaces)
          .some(workspace => workspace.id === workspaceId);
        setKind(isCommunity ? 'community' : 'enterprise');
      })
      .catch(() => {
        // Old approval emails are the main source of non-community links here.
        if (!cancelled) setKind('enterprise');
      });
    return (): void => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!workspaceId) {
    return <Navigate to='/community' replace />;
  }

  if (kind === 'loading') {
    return null;
  }

  const query = `?workspaceId=${encodeURIComponent(workspaceId)}`;
  return <Navigate to={kind === 'community' ? `/auth${query}` : `/enterprise/join${query}`} replace />;
};

export default CommunityJoinRoute;
