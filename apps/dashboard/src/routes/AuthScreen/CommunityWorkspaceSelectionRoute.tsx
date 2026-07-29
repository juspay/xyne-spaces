import { ReactElement } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ThemeProvider } from '@juspay/blend-design-system';
import { useAuth } from '../../hooks/useAuth';
import { CommunityWorkspaceScreen } from './CommunityWorkspaceScreen';

export const CommunityWorkspaceSelectionRoute = (): ReactElement => {
  const {
    isAuthenticated,
    user,
    pendingUserData,
    clearError,
    joinCommunityWorkspace,
    startEnterpriseLogin,
    communityJoinRequest,
  } = useAuth();
  const navigate = useNavigate();

  if (isAuthenticated) {
    return <Navigate to={user?.workspaceId ? `/${user.workspaceId}` : '/'} replace />;
  }

  return (
    <ThemeProvider>
      <CommunityWorkspaceScreen
        pendingUserData={pendingUserData}
        clearError={clearError}
        joinCommunityWorkspace={joinCommunityWorkspace}
        startEnterpriseLogin={startEnterpriseLogin}
        communityJoinRequest={communityJoinRequest}
        onContinueToAuth={() => {
          void navigate('/auth');
        }}
      />
    </ThemeProvider>
  );
};

export default CommunityWorkspaceSelectionRoute;
