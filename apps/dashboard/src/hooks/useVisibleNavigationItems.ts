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

  return useMemo(() => {
    const permittedItems = filterNavItemsByPermission(
      NAVIGATION_ITEMS,
      permissions,
      canManageOwnUserGroups,
    );
    // Guests are scoped to specific channels / canvases; Context (/memory)
    // and Knowledge Base are workspace-wide surfaces they must not see. The
    // Knowledge Base item is already resource-gated, but we hide it here too
    // as defense in depth alongside the route guard.
    const guestBlockedPaths = new Set(['/memory', '/knowledge-base']);
    const withoutGuestBlocked = isGuest
      ? permittedItems.filter(item => !guestBlockedPaths.has(item.path))
      : permittedItems;
    if (showClawDashboard) return withoutGuestBlocked;
    return withoutGuestBlocked.filter(item => item.path !== '/claw-agents');
  }, [permissions, canManageOwnUserGroups, showClawDashboard, isGuest]);
};
