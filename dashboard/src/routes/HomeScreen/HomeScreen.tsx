import { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePlatform } from '../../hooks/usePlatform';

const HomeScreen = (): ReactElement => {
  const { isMobile } = usePlatform();
  const { isNewUser } = useAuth();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefix = workspaceId ? `/${workspaceId}` : '';

  // If user is new, redirect to onboarding
  if (isNewUser) {
    return <Navigate to={`${prefix}/onboarding`} replace />;
  }
  return <Navigate to={isMobile ? `${prefix}/chat/dm` : `${prefix}/chat/dir`} replace />;
};

export default HomeScreen;
