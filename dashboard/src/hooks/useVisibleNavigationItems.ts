import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import {
  NAVIGATION_ITEMS,
  filterNavItemsByPermission,
  type NavigationItem,
} from '../components/AppSidebar/navigationConfig';

// Navigation items the current user is allowed to see, in canonical order.
export const useVisibleNavigationItems = (): NavigationItem[] => {
  const permissions = usePermissions();
  return useMemo(() => filterNavItemsByPermission(NAVIGATION_ITEMS, permissions), [permissions]);
};
