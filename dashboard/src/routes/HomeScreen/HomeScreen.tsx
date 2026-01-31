import { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { usePlatform } from '../../hooks/usePlatform';
import { useAuth } from '../../hooks/useAuth';

const HomeScreen = (): ReactElement => {
  const { isMobile } = usePlatform();
  const { isNewUser } = useAuth();

  // If user is new, redirect to onboarding
  if (isNewUser) {
    return <Navigate to='/onboarding' replace />;
  }
  return <Navigate to={isMobile ? '/chat/dm' : '/chat/dir'} replace />;
};

export default HomeScreen;
