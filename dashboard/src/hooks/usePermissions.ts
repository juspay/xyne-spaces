export {
  usePermissions,
  useHasAdminAccess,
  useCanCreateTicket,
  useCanReadTicket,
  useCanViewAnalytics,
  useHasResourceAccess,
  useCanManageUserActivity,
} from '@xyne/shared/hooks';

import { useHasResourceAccess } from '@xyne/shared/hooks';

export const useIsMemoryAdmin = (): boolean => {
  return useHasResourceAccess('MEMORY');
};
