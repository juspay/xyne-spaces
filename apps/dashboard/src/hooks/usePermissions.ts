export {
  usePermissions,
  useHasAdminAccess,
  useCanCreateTicket,
  useCanReadTicket,
  useCanViewAnalytics,
  useHasResourceAccess,
  useCanManageUserActivity,
} from '@xyne/shared/hooks';

import { useHasResourceAccess, usePermissions } from '@xyne/shared/hooks';
import { AccessType, meetsDeskInsightsAccess } from '@xyne/shared';
import { useAuth } from './useAuth';

export const useIsMemoryAdmin = (): boolean => {
  return useHasResourceAccess('MEMORY');
};
export const useCanCreateWorkspace = (): boolean => {
  const permissions = usePermissions();
  return permissions.some(
    permission =>
      permission.resourceName === 'WORKSPACE' &&
      (permission.accessType === AccessType.WRITE || permission.accessType === AccessType.ADMIN),
  );
};

// Desk email sending. SUPPORT READ is view-only: the holder can open the desk and
// read mail chains but cannot compose or reply. Scoped to the email chain only —
// Slack/social desk composers and ordinary sidebar chat are deliberately untouched.
// Admin/owner short-circuit (same shape as useCanManageRelease below) so a
// workspace admin can never be locked out of sending.
export const useCanSendDeskEmail = (): boolean => {
  const { user } = useAuth();
  const permissions = usePermissions();
  return (
    user?.role === 'ADMIN' ||
    user?.role === 'OWNER' ||
    user?.orgRole === 'ADMIN' ||
    user?.orgRole === 'OWNER' ||
    permissions.some(
      p =>
        p.resourceName === 'SUPPORT' &&
        (p.accessType === AccessType.WRITE || p.accessType === AccessType.ADMIN),
    )
  );
};

// Mirrors the backend's canViewDeskInsights SUPPORT-tier check.
export const useHasDeskInsightsAccess = (minAccess?: string | null): boolean => {
  const permissions = usePermissions();
  return meetsDeskInsightsAccess(
    permissions.filter(p => p.resourceName === 'SUPPORT').map(p => p.accessType),
    minAccess,
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
