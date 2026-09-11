import { Navigate } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useClawAdminAccessQuery } from '../../../hooks/useClawAdminAccess';

export function RequireClawAdmin({ children }: { children: ReactNode }): ReactElement | null {
  const { user } = useAuth();
  const { isAdmin, isLoading } = useClawAdminAccessQuery(user?.id);

  if (isLoading) return null;
  if (!isAdmin) return <Navigate to='../chat/new' replace />;
  return <>{children}</>;
}
