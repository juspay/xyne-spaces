import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { useAuth } from './useAuth';
import { useUserGroups } from './useUserGroup';
import {
  NAVIGATION_ITEMS,
  filterNavItemsByPermission,
  type NavigationItem,
} from '../components/AppSidebar/navigationConfig';
import { useClawDashboardVisibility } from './useClawDashboardVisibility';
import { useTelepresenceAnalyticsAccess } from './useTelepresenceAnalyticsAccess';

// Navigation items the current user is allowed to see, in canonical order.
export const useVisibleNavigationItems = (): NavigationItem[] => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const userGroups = useUserGroups();
  const canManageOwnUserGroups = userGroups.some(
    group => group.createdBy === user?.id && group.workspaceId === user?.workspaceId,
  );
  const { showClawDashboard } = useClawDashboardVisibility();
  const canViewTelepresenceAnalytics = useTelepresenceAnalyticsAccess();

  return useMemo(() => {
    let permittedItems = filterNavItemsByPermission(
      NAVIGATION_ITEMS,
      permissions,
      canManageOwnUserGroups,
    );
    if (!showClawDashboard) {
      permittedItems = permittedItems.filter(item => item.path !== '/claw-agents');
    }
    if (!canViewTelepresenceAnalytics) {
      permittedItems = permittedItems.filter(item => item.path !== '/analytics/telepresence');
    }
    return permittedItems;
  }, [permissions, canManageOwnUserGroups, showClawDashboard, canViewTelepresenceAnalytics]);
};
