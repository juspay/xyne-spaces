import type { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePlatform } from '../../hooks/usePlatform';
import { useAILandingDefault } from '../../hooks/useAILandingDefault';

const HomeScreen = (): ReactElement => {
  const { isMobile } = usePlatform();
  const { isNewUser } = useAuth();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { aiLandingDefault } = useAILandingDefault();
  const prefix = workspaceId ? `/${workspaceId}` : '';

  if (isNewUser) {
    return <Navigate to={`${prefix}/onboarding`} replace />;
  }

  if (!isMobile && aiLandingDefault) {
    return <Navigate to={`${prefix}/ai`} replace />;
  }

  return <Navigate to={isMobile ? `${prefix}/chat/dm` : `${prefix}/chat/dir`} replace />;
};

export default HomeScreen;
