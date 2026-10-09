import { ReactElement, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  PENDING_ENTERPRISE_WORKSPACE_ID_KEY,
  PENDING_WORKSPACE_ID_KEY,
  PENDING_WORKSPACE_NAME_KEY,
} from '../../machines/authMachine';

/**
 * Entry point for `/enterprise/join?workspaceId=...`, the link in the email sent
 * when an org admin approves a request to join an enterprise workspace.
 *
 * - Signed in: go straight to the workspace.
 * - Signed out: remember the workspace (PENDING_ENTERPRISE_WORKSPACE_ID_KEY) and
 *   start enterprise login, same as "Continue with work email". After login the
 *   auth machine opens that workspace instead of the last active one.
 */
export const EnterpriseJoinRoute = (): ReactElement | null => {
  const { isAuthenticated, isLoading, startEnterpriseLogin } = useAuth();
  const [searchParams] = useSearchParams();
  const workspaceId = searchParams.get('workspaceId')?.trim();
  const [isLoginPrepared, setIsLoginPrepared] = useState(false);

  const shouldStartLogin = !!workspaceId && !isLoading && !isAuthenticated;

  useEffect(() => {
    if (!shouldStartLogin || !workspaceId) return;
    localStorage.setItem(PENDING_ENTERPRISE_WORKSPACE_ID_KEY, workspaceId);
    // A pending community workspace would override the enterprise login intent.
    localStorage.removeItem(PENDING_WORKSPACE_ID_KEY);
    localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
    startEnterpriseLogin();
    setIsLoginPrepared(true);
  }, [shouldStartLogin, workspaceId, startEnterpriseLogin]);

  if (!workspaceId) {
    return <Navigate to='/auth' replace />;
  }

  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    return <Navigate to={`/${encodeURIComponent(workspaceId)}`} replace />;
  }

  if (!isLoginPrepared) {
    return null;
  }

  return <Navigate to='/auth' replace state={{ enterpriseLoginEntry: true }} />;
};

export default EnterpriseJoinRoute;
