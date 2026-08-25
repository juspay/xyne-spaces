import { useMemo } from 'react';
import { useCacConfig } from '@xyne/shared/hooks';

export const CMDK_SEARCH_CAC_KEY = 'cmdk_search_config';
// Per-deployment overrides come through the CAC key below.
const DEFAULT_RANK_PROFILE = 'default_native';

export interface CmdkSearchCacConfig {
  /** Legacy ALL-tab override. */
  allDefaultRankProfile: string;
  /** Per-tab default, keyed by TabType value ('messages', 'tickets', 'attachments', 'desk', ...). */
  tabDefaultRankProfiles?: Record<string, string>;
}

export const DEFAULT_CMDK_SEARCH_CAC_CONFIG: CmdkSearchCacConfig = {
  allDefaultRankProfile: DEFAULT_RANK_PROFILE,
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

// SearchFilterBar works in docType vocabulary, which differs from TabType for two tabs.
const DOC_TYPE_TO_TAB_KEY: Record<string, string> = {
  files: 'attachments',
  people: 'users',
};
export function cmdkTabKeyForDocType(docType: string): string {
  return DOC_TYPE_TO_TAB_KEY[docType] ?? docType;
}
