import { ReactElement } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  ENTERPRISE_WORKSPACE_LOGIN_INTENT_KEY,
  PENDING_COMMUNITY_WORKSPACE_ID_KEY,
  PENDING_COMMUNITY_WORKSPACE_NAME_KEY,
} from '../../machines/authMachine';

const CommunityWorkspaceInviteRedirect = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const workspaceId = searchParams.get('workspaceId')?.trim();

  if (!workspaceId) {
    return <Navigate to='/community' replace />;
  }

  localStorage.removeItem(ENTERPRISE_WORKSPACE_LOGIN_INTENT_KEY);
  localStorage.setItem(PENDING_COMMUNITY_WORKSPACE_ID_KEY, workspaceId);
  localStorage.removeItem(PENDING_COMMUNITY_WORKSPACE_NAME_KEY);

  return <Navigate to='/auth?communityInvite=1' replace />;
};

export default CommunityWorkspaceInviteRedirect;
