import { useMemo } from 'react';
import { useCacConfig } from '@xyne/shared/hooks';

export const CMDK_SEARCH_CAC_KEY = 'cmdk_search_config';
// Safe for the open-source Vespa schemas, which define no `personalized` profile. Enterprise
// (private vespa-core schemas) turns personalization on per tab through the CAC key below.
const DEFAULT_RANK_PROFILE = 'default_native';

export interface CmdkSearchCacConfig {
  /** Legacy ALL-tab override, kept so existing Superposition configs keep working. */
  allDefaultRankProfile: string;
  /**
   * Per-tab default rank profile, keyed by TabType value ('all', 'messages', 'tickets',
   * 'files', 'desk', ...). Missing tabs fall back to allDefaultRankProfile for 'all' and
   * default_native otherwise.
   */
  tabDefaultRankProfiles?: Record<string, string>;
}

export const DEFAULT_CMDK_SEARCH_CAC_CONFIG: CmdkSearchCacConfig = {
  allDefaultRankProfile: DEFAULT_RANK_PROFILE,
};

/**
 * Resolves the default rank profile per Cmd+K tab through Superposition CAC.
 *
 * CAC key: `cmdk_search_config`
 * Code default: every tab -> `default_native` (the open-source schemas have no other profile).
 * Enterprise override example:
 *   { "allDefaultRankProfile": "personalized",
 *     "tabDefaultRankProfiles": { "messages": "personalized", "tickets": "personalized",
 *                                 "files": "personalized", "desk": "personalized" } }
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

/** Legacy accessor for the ALL tab, used by SearchFilterBar's label. */
export function useCmdkAllDefaultRankProfile(): string {
  return useCmdkDefaultRankProfiles()('all');
}
