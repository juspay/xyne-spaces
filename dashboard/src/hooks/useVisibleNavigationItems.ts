import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { useAuth } from './useAuth';
import { useUserGroups } from './useUserGroup';
import {
  NAVIGATION_ITEMS,
  filterNavItemsByPermission,
  type NavigationItem,
} from '../components/AppSidebar/navigationConfig';

// Navigation items the current user is allowed to see, in canonical order.
export const useVisibleNavigationItems = (): NavigationItem[] => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const userGroups = useUserGroups();
  const canManageOwnUserGroups = userGroups.some(
    group => group.createdBy === user?.id && group.workspaceId === user?.workspaceId,
  );

  return useMemo(
    () => filterNavItemsByPermission(NAVIGATION_ITEMS, permissions, canManageOwnUserGroups),
    [permissions, canManageOwnUserGroups],
  );
};
