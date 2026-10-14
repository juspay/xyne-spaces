import { useMemo } from 'react';
import { useCacConfig } from '@xyne/shared/hooks';
import {
  CMDK_SEARCH_CAC_KEY,
  DEFAULT_CMDK_SEARCH_CAC_CONFIG,
  DEFAULT_FLAT_ALL_RANK_PROFILES,
  cmdkDefaultRankProfiles,
  cmdkTabKeyForDocType,
  type CmdkFullPageCacConfig,
  type CmdkSearchCacConfig,
} from '@xyne/shared/utils';
import { DEFAULT_CMDK_POLICY_OPTIONS, type CmdkPolicyOptions } from '../search/cmdkPolicy';

// The config and its rank-profile rules live in `@xyne/shared` (shared with mobile search).
export { CMDK_SEARCH_CAC_KEY, DEFAULT_CMDK_SEARCH_CAC_CONFIG, cmdkTabKeyForDocType };
export type { CmdkFullPageCacConfig, CmdkSearchCacConfig };

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

const intAtLeast = (value: unknown, min: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min
    ? Math.floor(value)
    : fallback;

/**
 * Cmd+K full-page policy thresholds from the `cmdk_search_config` CAC key (`fullPage`). Shares the
 * CAC query cache with the rank-profile hooks. Missing or invalid values keep
 * DEFAULT_CMDK_POLICY_OPTIONS.
 */
export function useCmdkPolicyOptions(): CmdkPolicyOptions {
  const { config } = useCacConfig<CmdkSearchCacConfig>({
    key: CMDK_SEARCH_CAC_KEY,
    fallbackConfig: DEFAULT_CMDK_SEARCH_CAC_CONFIG,
  });
  return useMemo(() => {
    const fullPage = config.fullPage ?? {};
    const defaults = DEFAULT_CMDK_POLICY_OPTIONS;
    return {
      // 0 turns the quick return / the banner off; a streak of 0 would mean nothing, so it
      // stays ≥ 1.
      returnWindowMs:
        intAtLeast(fullPage.returnWindowSec, 0, defaults.returnWindowMs / 1000) * 1000,
      fullPageStreak: intAtLeast(fullPage.fullPageStreak, 1, defaults.fullPageStreak),
      maxBannerShows: intAtLeast(fullPage.maxBannerShows, 0, defaults.maxBannerShows),
    };
  }, [config]);
}
