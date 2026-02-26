import { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';

interface ResourceProtectedRouteProps {
  resourceName: string;
  children: ReactElement;
}

/**
 * Route guard that checks if user has ADMIN access to a resource.
 * Redirects to home page if access is denied.
 * NOTE: Currently only ADMIN can access resource-based routes. Change to include READ/WRITE if needed.
 */
export const ResourceProtectedRoute = ({
  resourceName,
  children,
}: ResourceProtectedRouteProps): ReactElement => {
  const permissions = usePermissions();

  const hasAccess = permissions.some(p => {
    if (p.resourceName !== resourceName) return false;
    if (p.accessType === 'ADMIN') return true;
    if (resourceName === 'USER-GROUPS' && p.accessType === 'WRITE') return true;
    return false;
  });

  if (!hasAccess) {
    return <Navigate to='/' replace />;
  }

  return children;
};
