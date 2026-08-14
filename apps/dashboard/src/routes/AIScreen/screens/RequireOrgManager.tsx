import { Navigate } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { useClawOrgManageAccess } from '../../../hooks/useClawOrganization';

export function RequireOrgManager({ children }: { children: ReactNode }): ReactElement | null {
  const { canManage, isLoading } = useClawOrgManageAccess();

  if (isLoading) return null;
  if (!canManage) return <Navigate to='../chat/new' replace />;
  return <>{children}</>;
}
