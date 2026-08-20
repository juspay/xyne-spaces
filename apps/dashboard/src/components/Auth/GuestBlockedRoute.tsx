import { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { WorkspaceRole } from '@xyne/shared';
import { useAuth } from '../../hooks/useAuth';

interface GuestBlockedRouteProps {
  children: ReactElement;
}

/**
 * Route guard that blocks workspace GUEST users from a whole section.
 *
 * Guests are invited to specific channels / canvases only; they must never
 * reach workspace-wide surfaces (Claw Agents, Context, Knowledge Base, etc.)
 * even by typing the URL directly. Non-guest roles pass through unchanged.
 *
 * Redirects denied guests to the workspace home instead of rendering the
 * protected subtree.
 */
export const GuestBlockedRoute = ({ children }: GuestBlockedRouteProps): ReactElement => {
  const { user } = useAuth();
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  if (user?.role === WorkspaceRole.GUEST) {
    return <Navigate to={workspaceId ? `/${workspaceId}` : '/'} replace />;
  }

  return children;
};
