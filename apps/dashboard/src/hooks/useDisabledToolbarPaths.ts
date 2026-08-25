import { useMemo } from 'react';
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
  // config has stable identity across renders (react-query keeps the same
  // `data` reference until a refetch resolves), so memoizing on it keeps
  // this Set's identity stable too — callers put it in useMemo/useCallback
  // deps (useVisibleNavigationItems), which would otherwise recompute every
  // render against a freshly-built Set.
  return useMemo(() => new Set(config), [config]);
};
