import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { useAuth } from './useAuth';
import { WorkspaceRole } from '@xyne/shared';
import { useUserGroups } from './useUserGroup';
import {
  NAVIGATION_ITEMS,
  filterNavItemsByPermission,
  type NavigationItem,
} from '../components/AppSidebar/navigationConfig';
import { useClawDashboardVisibility } from './useClawDashboardVisibility';
import { useDisabledToolbarPaths } from './useDisabledToolbarPaths';

// Navigation items the current user is allowed to see, in canonical order.
export const useVisibleNavigationItems = (): NavigationItem[] => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const userGroups = useUserGroups();
  const canManageOwnUserGroups = userGroups.some(
    group => group.createdBy === user?.id && group.workspaceId === user?.workspaceId,
  );
  const { showClawDashboard } = useClawDashboardVisibility();
  const isGuest = user?.role === WorkspaceRole.GUEST;
  const disabledToolbarPaths = useDisabledToolbarPaths();

  return useMemo(() => {
    const permittedItems = filterNavItemsByPermission(
      NAVIGATION_ITEMS,
      permissions,
      canManageOwnUserGroups,
    );
    // Guests are scoped to specific channels / canvases; the Claw Agents
    // section is a workspace-wide surface they must not see.
    const withoutGuestBlocked = isGuest
      ? permittedItems.filter(item => item.path !== '/claw-agents')
      : permittedItems;
    const visibleItems = showClawDashboard
      ? withoutGuestBlocked
      : withoutGuestBlocked.filter(item => item.path !== '/claw-agents');
    return visibleItems.filter(item => !disabledToolbarPaths.has(item.path));
  }, [permissions, canManageOwnUserGroups, showClawDashboard, isGuest, disabledToolbarPaths]);
};
