import { Navigate } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useClawAdminAccessQuery } from '../../../hooks/useClawAdminAccess';
import { useHasResourceAccess } from '../../../hooks/usePermissions';

export function RequireClawAdmin({
  children,
  orSdlcAdmin = false,
}: {
  children: ReactNode;
  orSdlcAdmin?: boolean;
}): ReactElement | null {
  const { user } = useAuth();
  const { isAdmin, isLoading } = useClawAdminAccessQuery(user?.id);
  const isSdlcAdmin = useHasResourceAccess('SDLC');

  if (orSdlcAdmin && isSdlcAdmin) return <>{children}</>;
  if (isLoading) return null;
  if (!isAdmin) return <Navigate to='../chat/new' replace />;
  return <>{children}</>;
}
