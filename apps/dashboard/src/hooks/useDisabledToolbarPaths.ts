import { useCachedQuery } from './useCachedQuery';
import { useSelf } from './useUsers';
import { queries } from '../zero/queries';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(v => typeof v === 'string');

// Workspace-admin-disabled toolbar paths (Workspace Management → Toolbar),
// shared by the sidebar's visibility filter (useVisibleNavigationItems) and
// the route-level guard (ToolbarProtectedRoute) so both read the same set.
export const useDisabledToolbarPaths = (): Set<string> | undefined => {
  const self = useSelf();
  const workspaceId = self?.workspaceId;
  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId: workspaceId || '' }), {
    enabled: !!workspaceId,
  });
  const metadata =
    workspace?.metadata && typeof workspace.metadata === 'object' && !Array.isArray(workspace.metadata)
      ? (workspace.metadata as Record<string, unknown>)
      : undefined;
  return isStringArray(metadata?.disabledToolbarPaths) ? new Set(metadata.disabledToolbarPaths) : undefined;
};
