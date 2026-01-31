import { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const ProtectedRoute = (): ReactElement => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    const searchParams = new URLSearchParams(location.search);
    const authParams = new URLSearchParams();
    if (searchParams.has('enrollment_success')) {
      authParams.set('enrollment_success', searchParams.get('enrollment_success') || '');
    }

    const authQueryString = authParams.toString();
    return <Navigate to={`/auth?${authQueryString}`} replace />;
  }

  return (
    <>
      <Outlet></Outlet>
    </>
  );
};

export default ProtectedRoute;
