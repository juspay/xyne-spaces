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

export const useIsMemoryAdmin = (): boolean => {
  return useHasResourceAccess('MEMORY');
};
export const useCanCreateWorkspace = (): boolean => {
  const permissions = usePermissions();
  return permissions.some(
    permission =>
      permission.resourceName === 'WORKSPACE' &&
      (permission.accessType === 'WRITE' || permission.accessType === 'ADMIN'),
  );
};
