import { useCacConfig } from '@xyne/shared/hooks';
import {
  DISABLED_TOOLBAR_PATHS_CAC_KEY,
  DEFAULT_DISABLED_TOOLBAR_PATHS_CAC_CONFIG,
} from '../components/AppSidebar/toolbarCacConfig';

// Per-workspace toolbar paths hidden via Superposition CAC (disabled_toolbar_paths,
// targeted by workspaceId — see cacConfigController.ts), shared by the sidebar's
// visibility filter (useVisibleNavigationItems) and the route-level guard
// (ToolbarProtectedRoute) so both read the same set.
export const useDisabledToolbarPaths = (): Set<string> => {
  const { config } = useCacConfig<string[]>({
    key: DISABLED_TOOLBAR_PATHS_CAC_KEY,
    fallbackConfig: DEFAULT_DISABLED_TOOLBAR_PATHS_CAC_CONFIG,
  });
  return new Set(config);
};
