import { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../hooks/useAuth';
import { useUserGroups, useUserGroupsHydrated } from '../../hooks/useUserGroup';
import AppLoader from '../AppLoader/AppLoader';

type AccessLevel = 'READ' | 'WRITE' | 'ADMIN';

interface ResourceProtectedRouteProps {
  resourceName: string;
  /** Minimum access tier required. Defaults to ADMIN to preserve legacy
   *  call-sites that pre-date tiered access. ADMIN cascades into WRITE and
   *  READ; WRITE cascades into READ. */
  minAccess?: AccessLevel;
  /** Allow creators to access their own user groups without a global grant. */
  allowUserGroupCreator?: boolean;
  children: ReactElement;
}

function satisfies(holderType: string, minLevel: AccessLevel): boolean {
  if (holderType === 'ADMIN') return true;
  if (holderType === 'WRITE') return minLevel === 'WRITE' || minLevel === 'READ';
  if (holderType === 'READ') return minLevel === 'READ';
  return false;
}

/**
 * Route guard that checks if a user holds the requested access tier on a
 * resource. Redirects to home page if access is denied.
 */
export const ResourceProtectedRoute = ({
  resourceName,
  minAccess = 'ADMIN',
  allowUserGroupCreator = false,
  children,
}: ResourceProtectedRouteProps): ReactElement => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const userGroups = useUserGroups();
  const userGroupsHydrated = useUserGroupsHydrated();
  const { workspaceId, userGroupId } = useParams<{
    workspaceId?: string;
    userGroupId?: string;
  }>();

  const hasResourceAccess = permissions.some(p => {
    if (p.resourceName !== resourceName) return false;
    if (satisfies(p.accessType, minAccess)) return true;
    // Legacy carve-out: USER-GROUPS treats WRITE as eligible even when the
    // route requested ADMIN. New code should pass minAccess explicitly.
    if (resourceName === 'USER-GROUPS' && p.accessType === 'WRITE') return true;
    return false;
  });

  const shouldCheckCreatorAccess =
    allowUserGroupCreator && resourceName === 'USER-GROUPS' && !hasResourceAccess;
  const activeWorkspaceId = workspaceId ?? user?.workspaceId;

  if (shouldCheckCreatorAccess && !userGroupsHydrated) {
    return <AppLoader />;
  }

  const hasCreatorAccess =
    shouldCheckCreatorAccess &&
    userGroups.some(
      group =>
        group.createdBy === user?.id &&
        group.workspaceId === activeWorkspaceId &&
        (userGroupId === undefined || group.id === userGroupId),
    );

  if (!hasResourceAccess && !hasCreatorAccess) {
    return <Navigate to={workspaceId ? `/${workspaceId}` : '/'} replace />;
  }

  return children;
};
