import { useMemo } from 'react';
import { useCacConfig } from '@xyne/shared/hooks';
import {
  CMDK_SEARCH_CAC_KEY,
  DEFAULT_CMDK_SEARCH_CAC_CONFIG,
  DEFAULT_FLAT_ALL_RANK_PROFILES,
  cmdkDefaultRankProfiles,
  cmdkTabKeyForDocType,
  type CmdkSearchCacConfig,
} from '@xyne/shared/utils';

// The config and its rank-profile rules live in `@xyne/shared` (shared with mobile search).
export { CMDK_SEARCH_CAC_KEY, DEFAULT_CMDK_SEARCH_CAC_CONFIG, cmdkTabKeyForDocType };
export type { CmdkSearchCacConfig };

/**
 * Default rank profile per Cmd+K tab: `default_native` unless the `cmdk_search_config` CAC key
 * overrides it (allDefaultRankProfile for the ALL tab, tabDefaultRankProfiles per tab).
 */
export function useCmdkDefaultRankProfiles(): (tab: string) => string {
  const { config } = useCacConfig<CmdkSearchCacConfig>({
    key: CMDK_SEARCH_CAC_KEY,
    fallbackConfig: DEFAULT_CMDK_SEARCH_CAC_CONFIG,
  });
  return useMemo(() => cmdkDefaultRankProfiles(config), [config]);
}

/**
 * Rank profiles whose ALL-tab results skip docType grouping, from the `cmdk_search_config` CAC key
 * (`flatAllRankProfiles`). Shares the CAC query cache with `useCmdkDefaultRankProfiles`, so reading
 * both costs one request. Defaults to `['unified']` when the key omits the field.
 */
export function useCmdkFlatAllRankProfiles(): Set<string> {
  const { config } = useCacConfig<CmdkSearchCacConfig>({
    key: CMDK_SEARCH_CAC_KEY,
    fallbackConfig: DEFAULT_CMDK_SEARCH_CAC_CONFIG,
  });
  return useMemo(() => {
    const profiles = config.flatAllRankProfiles ?? DEFAULT_FLAT_ALL_RANK_PROFILES;
    return new Set(profiles.map(p => p?.trim().toLowerCase()).filter(Boolean));
  }, [config]);
}
