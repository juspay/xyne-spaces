import { useMemo } from 'react';
import { useCacConfig } from '@xyne/shared/hooks';
import { DEFAULT_CMDK_POLICY_OPTIONS, type CmdkPolicyOptions } from '../search/cmdkPolicy';

export const CMDK_SEARCH_CAC_KEY = 'cmdk_search_config';
// Per-deployment overrides come through the CAC key below.
const DEFAULT_RANK_PROFILE = 'default_native';
// Rank profiles whose scores are directly comparable across schemas, so the ALL tab can render
// one global score-ordered list instead of per-docType buckets. `unified` normalizes every
// schema's score into the same 0-1 range; add others (e.g. `personalized`) via CAC.
const DEFAULT_FLAT_ALL_RANK_PROFILES = ['unified'];

export interface CmdkSearchCacConfig {
  /** Legacy ALL-tab override. */
  allDefaultRankProfile: string;
  /** Per-tab default, keyed by TabType value ('messages', 'tickets', 'attachments', 'desk', ...). */
  tabDefaultRankProfiles?: Record<string, string>;
  /**
   * Rank profiles that render the ALL tab flat (one score-ordered list) instead of grouped by
   * docType. Any profile not listed here keeps the sectioned ALL view.
   */
  flatAllRankProfiles?: string[];
  /** Full-page open policy thresholds; any field left out keeps its default. */
  fullPage?: CmdkFullPageCacConfig;
}

export interface CmdkFullPageCacConfig {
  /**
   * Seconds after opening a result during which a Cmd+K reopen restores it (default 15; 0 = off).
   */
  returnWindowSec?: number;
  /** Consecutive full-page sessions that switch the default to full page (default 2). */
  fullPageStreak?: number;
  /** Times the return banner may show while full page is still unused (default 5; 0 = off). */
  maxBannerShows?: number;
}

export const DEFAULT_CMDK_SEARCH_CAC_CONFIG: CmdkSearchCacConfig = {
  allDefaultRankProfile: DEFAULT_RANK_PROFILE,
  flatAllRankProfiles: DEFAULT_FLAT_ALL_RANK_PROFILES,
};

/**
 * Default rank profile per Cmd+K tab: `default_native` unless the `cmdk_search_config` CAC key
 * overrides it (allDefaultRankProfile for the ALL tab, tabDefaultRankProfiles per tab).
 */
export function useCmdkDefaultRankProfiles(): (tab: string) => string {
  const { config } = useCacConfig<CmdkSearchCacConfig>({
    key: CMDK_SEARCH_CAC_KEY,
    fallbackConfig: DEFAULT_CMDK_SEARCH_CAC_CONFIG,
  });
  return useMemo(() => {
    const perTab = config.tabDefaultRankProfiles ?? {};
    const allDefault = config.allDefaultRankProfile?.trim().toLowerCase() || DEFAULT_RANK_PROFILE;
    return (tab: string) =>
      perTab[tab]?.trim().toLowerCase() || (tab === 'all' ? allDefault : DEFAULT_RANK_PROFILE);
  }, [config]);
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

// SearchFilterBar works in docType vocabulary, which differs from TabType for two tabs.
const DOC_TYPE_TO_TAB_KEY: Record<string, string> = {
  files: 'attachments',
  people: 'users',
};
export function cmdkTabKeyForDocType(docType: string): string {
  return DOC_TYPE_TO_TAB_KEY[docType] ?? docType;
}
