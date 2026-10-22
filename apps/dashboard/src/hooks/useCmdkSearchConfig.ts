import { useMemo } from 'react';
import { useCacConfig } from '@xyne/shared/hooks';
import {
  CMDK_SEARCH_CAC_KEY,
  DEFAULT_CMDK_SEARCH_CAC_CONFIG,
  cmdkTabKeyForDocType,
  type CmdkFullPageCacConfig,
  type CmdkSearchCacConfig,
} from '@xyne/shared/utils';
import { DEFAULT_CMDK_POLICY_OPTIONS, type CmdkPolicyOptions } from '../search/cmdkPolicy';

// The config, its rank-profile rules and the rank-profile hooks live in `@xyne/shared` (shared
// with mobile search). The full-page policy hook below stays here: it uses the dashboard's cmdkPolicy.
export { CMDK_SEARCH_CAC_KEY, DEFAULT_CMDK_SEARCH_CAC_CONFIG, cmdkTabKeyForDocType };
export { useCmdkDefaultRankProfiles, useCmdkFlatAllRankProfiles } from '@xyne/shared/hooks';
export type { CmdkFullPageCacConfig, CmdkSearchCacConfig };

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
