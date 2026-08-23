import { useCacConfig } from '@xyne/shared/hooks';

export const CMDK_SEARCH_CAC_KEY = 'cmdk_search_config';
const DEFAULT_ALL_RANK_PROFILE = 'personalized';

export interface CmdkSearchCacConfig {
  allDefaultRankProfile: string;
}

export const DEFAULT_CMDK_SEARCH_CAC_CONFIG: CmdkSearchCacConfig = {
  allDefaultRankProfile: DEFAULT_ALL_RANK_PROFILE,
};

/**
 * Resolves the ALL-tab rank profile through Superposition CAC.
 *
 * The backend supplies `environment: playground` when Electron's pre-prod
 * routing toggle is active. Production falls back to `personalized`.
 *
 * CAC key: `cmdk_search_config`
 * Default value: { "allDefaultRankProfile": "personalized" }
 * Playground override: { "allDefaultRankProfile": "unified" }
 */
export function useCmdkAllDefaultRankProfile(): string {
  const { config } = useCacConfig<CmdkSearchCacConfig>({
    key: CMDK_SEARCH_CAC_KEY,
    fallbackConfig: DEFAULT_CMDK_SEARCH_CAC_CONFIG,
  });
  const configuredRankProfile = config.allDefaultRankProfile?.trim().toLowerCase();

  return configuredRankProfile || DEFAULT_ALL_RANK_PROFILE;
}
