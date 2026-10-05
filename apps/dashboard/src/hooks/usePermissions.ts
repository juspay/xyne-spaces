export {
  usePermissions,
  useHasAdminAccess,
  useCanCreateTicket,
  useCanReadTicket,
  useCanViewAnalytics,
  useHasResourceAccess,
  useCanManageUserActivity,
} from '@xyne/shared/hooks';

import { usePermissions } from '@xyne/shared/hooks';
import { AccessType } from '@xyne/shared';
import { useAuth } from './useAuth';

export const useCanCreateWorkspace = (): boolean => {
  const permissions = usePermissions();
  return permissions.some(
    permission =>
      permission.resourceName === 'WORKSPACE' &&
      (permission.accessType === AccessType.WRITE || permission.accessType === AccessType.ADMIN),
  );
};

// Mirrors the backend's assertReleaseManageAccess(): admin/owner role, or RELEASE-MANAGER WRITE.
export const useCanManageRelease = (): boolean => {
  const { user } = useAuth();
  const permissions = usePermissions();
  return (
    user?.role === 'ADMIN' ||
    user?.role === 'OWNER' ||
    user?.orgRole === 'ADMIN' ||
    user?.orgRole === 'OWNER' ||
    permissions.some(
      p =>
        p.resourceName === 'RELEASE-MANAGER' &&
        (p.accessType === AccessType.WRITE || p.accessType === AccessType.ADMIN),
    )
  );
};

// Mirrors the backend's authMiddleware.requireAdminOrOwner (workspace or org admin/owner).
export const useIsAdminOrOwner = (): boolean => {
  const { user } = useAuth();
  return (
    user?.role === 'ADMIN' ||
    user?.role === 'OWNER' ||
    user?.orgRole === 'ADMIN' ||
    user?.orgRole === 'OWNER'
  );
};
