import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { useAuth } from './useAuth';
import { WorkspaceRole } from '@xyne/shared';
import { useUserGroups } from './useUserGroup';
import { useSelf } from './useUsers';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import {
  NAVIGATION_ITEMS,
  filterNavItemsByPermission,
  type NavigationItem,
} from '../components/AppSidebar/navigationConfig';
import { useClawDashboardVisibility } from './useClawDashboardVisibility';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(v => typeof v === 'string');

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

  const self = useSelf();
  const workspaceId = self?.workspaceId;
  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId: workspaceId || '' }), {
    enabled: !!workspaceId,
  });
  const metadata =
    workspace?.metadata && typeof workspace.metadata === 'object' && !Array.isArray(workspace.metadata)
      ? (workspace.metadata as Record<string, unknown>)
      : undefined;
  const disabledToolbarPaths = isStringArray(metadata?.disabledToolbarPaths)
    ? new Set(metadata.disabledToolbarPaths)
    : undefined;

  return useMemo(() => {
    let permittedItems = filterNavItemsByPermission(
      NAVIGATION_ITEMS,
      permissions,
      canManageOwnUserGroups,
    );
    // Guests are scoped to specific channels / canvases; the Claw Agents
    // section is a workspace-wide surface they must not see.
    const withoutGuestBlocked = isGuest
      ? permittedItems.filter(item => item.path !== '/claw-agents')
      : permittedItems;
    let visibleItems = showClawDashboard
      ? withoutGuestBlocked
      : withoutGuestBlocked.filter(item => item.path !== '/claw-agents');
    if (disabledToolbarPaths) {
      visibleItems = visibleItems.filter(item => !disabledToolbarPaths.has(item.path));
    }
    return visibleItems;
  }, [permissions, canManageOwnUserGroups, showClawDashboard, isGuest, disabledToolbarPaths]);
};
