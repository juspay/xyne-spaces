import { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const HomeScreen = (): ReactElement => {
  const { isNewUser } = useAuth();

  // If user is new, redirect to onboarding
  if (isNewUser) {
    return <Navigate to='/onboarding' replace />;
  }
  return <Navigate to='/chat/dir' replace />;
};

export default HomeScreen;
