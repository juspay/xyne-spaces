import { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';

type AccessLevel = 'READ' | 'WRITE' | 'ADMIN';

interface ResourceProtectedRouteProps {
  resourceName: string;
  /** Minimum access tier required. Defaults to ADMIN to preserve legacy
   *  call-sites that pre-date tiered access. ADMIN cascades into WRITE and
   *  READ; WRITE cascades into READ. */
  minAccess?: AccessLevel;
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
  children,
}: ResourceProtectedRouteProps): ReactElement => {
  const permissions = usePermissions();

  const hasAccess = permissions.some(p => {
    if (p.resourceName !== resourceName) return false;
    if (satisfies(p.accessType, minAccess)) return true;
    // Legacy carve-out: USER-GROUPS treats WRITE as eligible even when the
    // route requested ADMIN. New code should pass minAccess explicitly.
    if (resourceName === 'USER-GROUPS' && p.accessType === 'WRITE') return true;
    return false;
  });

  const { workspaceId } = useParams<{ workspaceId?: string }>();

  if (!hasAccess) {
    return <Navigate to={workspaceId ? `/${workspaceId}` : '/'} replace />;
  }

  return children;
};
