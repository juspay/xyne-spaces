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
import { AccessType } from '@xyne/shared';

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
