import { useMemo } from 'react';
import { useCacConfig } from '@xyne/shared/hooks';
import { useAuth } from './useAuth';
import {
  DISABLED_TOOLBAR_PATHS_CAC_KEY,
  DEFAULT_DISABLED_TOOLBAR_PATHS_CAC_CONFIG,
  type DisabledToolbarPathsCacConfig,
} from '../components/AppSidebar/toolbarCacConfig';

// Toolbar paths hidden via Superposition CAC (disabled_toolbar_paths) — one
// global key shared by all of xyne-spaces. The VALUE, not the key, carries
// the per-workspace split: a map from xyne-spaces workspaceId to that
// workspace's hidden-path list (see toolbarCacConfig.ts for why — the
// upstream Superposition instance is provisioned as a single org/workspace
// for all of xyne-spaces in prod). Shared by the sidebar's visibility
// filter (useVisibleNavigationItems) and the route-level guard
// (ToolbarProtectedRoute) so both read the same set.
export const useDisabledToolbarPaths = (): Set<string> => {
  const { user } = useAuth();
  const { config } = useCacConfig<DisabledToolbarPathsCacConfig>({
    key: DISABLED_TOOLBAR_PATHS_CAC_KEY,
    fallbackConfig: DEFAULT_DISABLED_TOOLBAR_PATHS_CAC_CONFIG,
  });
  const paths = user?.workspaceId ? config[user.workspaceId] : undefined;
  // config has stable identity across renders (react-query keeps the same
  // `data` reference until a refetch resolves), so memoizing on it keeps
  // this Set's identity stable too — callers put it in useMemo/useCallback
  // deps (useVisibleNavigationItems), which would otherwise recompute every
  // render against a freshly-built Set.
  return useMemo(() => new Set(paths ?? []), [paths]);
};
