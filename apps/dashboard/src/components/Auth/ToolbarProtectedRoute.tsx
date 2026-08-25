import { ReactElement } from 'react';
import { useDisabledToolbarPaths } from '../../hooks/useDisabledToolbarPaths';
import NotFoundScreen from '../../routes/NotFoundScreen/NotFoundScreen';

interface ToolbarProtectedRouteProps {
  path: string;
  children: ReactElement;
}

/**
 * Route guard mirroring ResourceProtectedRoute, but for per-workspace
 * toolbar-disabled paths (Superposition CAC key disabled_toolbar_paths,
 * targeted by workspaceId) instead of an RBAC resource. A disabled path
 * renders the same 404 as a URL that doesn't match any route — from the
 * requester's side, a workspace-disabled item and a nonexistent one should
 * look identical, not tip off that it exists but is merely off-limits
 * (that's what ResourceProtectedRoute's home-redirect would imply instead).
 */
export const ToolbarProtectedRoute = ({
  path,
  children,
}: ToolbarProtectedRouteProps): ReactElement => {
  const disabledToolbarPaths = useDisabledToolbarPaths();

  if (disabledToolbarPaths.has(path)) {
    return <NotFoundScreen />;
  }

  return children;
};
