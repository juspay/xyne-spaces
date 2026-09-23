import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { useAuth } from './useAuth';
import { useUserGroups } from './useUserGroup';
import {
  NAVIGATION_ITEMS,
  filterNavItemsByPermission,
  type NavigationItem,
} from '../components/AppSidebar/navigationConfig';
import { useDisabledToolbarPaths } from './useDisabledToolbarPaths';
import { useStreamsVisibility } from './useStreamsVisibility';
import { usePlatform } from './usePlatform';

// Navigation items the current user is allowed to see, in canonical order.
export const useVisibleNavigationItems = (): NavigationItem[] => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const userGroups = useUserGroups();
  const canManageOwnUserGroups = userGroups.some(
    group => group.createdBy === user?.id && group.workspaceId === user?.workspaceId,
  );
  const disabledToolbarPaths = useDisabledToolbarPaths();
  const { showStreams } = useStreamsVisibility();
  // Streams is a horizontal strip of fixed-width columns — 280px at its
  // narrowest, wider for most surfaces — so a phone fits one column and a
  // scrollbar. Hidden rather than adapted: a single column is the app it
  // already has, and the feature's whole proposition is the things beside it.
  const { isMobile } = usePlatform();

  return useMemo(() => {
    const visibleItems = filterNavItemsByPermission(
      NAVIGATION_ITEMS,
      permissions,
      canManageOwnUserGroups,
    );
    // Streams' single flag. This hook feeds both the sidebar and the list in
    // Preferences > Toolbar, so dropping it here means off is genuinely absent —
    // not merely hidden from the rail while still offered in settings.
    const withStreams =
      showStreams && !isMobile
        ? visibleItems
        : visibleItems.filter(item => item.path !== '/streams');
    return withStreams.filter(item => !disabledToolbarPaths.has(item.path));
  }, [permissions, canManageOwnUserGroups, showStreams, isMobile, disabledToolbarPaths]);
};
