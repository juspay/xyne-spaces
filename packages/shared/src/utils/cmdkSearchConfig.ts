/**
 * Cmd+K search rank-profile config (`cmdk_search_config` CAC key), shared by the dashboard
 * (Cmd+K, full search screen) and the mobile app's global search so both ask the backend for
 * the same rank profile per tab. Moved verbatim from the dashboard's `hooks/useCmdkSearchConfig.ts`;
 * each app reads the CAC key with its own hook and resolves it here.
 */

export const CMDK_SEARCH_CAC_KEY = 'cmdk_search_config';
// Per-deployment overrides come through the CAC key below.
const DEFAULT_RANK_PROFILE = 'default_native';
// Rank profiles whose scores are directly comparable across schemas, so the ALL tab can render
// one global score-ordered list instead of per-docType buckets. `unified` normalizes every
// schema's score into the same 0-1 range; add others (e.g. `personalized`) via CAC.
export const DEFAULT_FLAT_ALL_RANK_PROFILES = ['unified'];

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
}

export const DEFAULT_CMDK_SEARCH_CAC_CONFIG: CmdkSearchCacConfig = {
  allDefaultRankProfile: DEFAULT_RANK_PROFILE,
  flatAllRankProfiles: DEFAULT_FLAT_ALL_RANK_PROFILES,
};

/**
 * Default rank profile per Cmd+K tab: `default_native` unless the `cmdk_search_config` CAC key
 * overrides it (allDefaultRankProfile for the ALL tab, tabDefaultRankProfiles per tab).
 */
export function cmdkDefaultRankProfiles(config: CmdkSearchCacConfig): (tab: string) => string {
  const perTab = config.tabDefaultRankProfiles ?? {};
  const allDefault = config.allDefaultRankProfile?.trim().toLowerCase() || DEFAULT_RANK_PROFILE;
  return (tab: string) =>
    perTab[tab]?.trim().toLowerCase() || (tab === 'all' ? allDefault : DEFAULT_RANK_PROFILE);
}

// SearchFilterBar works in docType vocabulary, which differs from TabType for two tabs.
const DOC_TYPE_TO_TAB_KEY: Record<string, string> = {
  files: 'attachments',
  people: 'users',
};
export function cmdkTabKeyForDocType(docType: string): string {
  return DOC_TYPE_TO_TAB_KEY[docType] ?? docType;
}
