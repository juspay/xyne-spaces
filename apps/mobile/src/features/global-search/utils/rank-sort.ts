/**
 * Page-level Rank / Sort controls.
 * Mirrors dashboard SORT_OPTIONS + RANK_PROFILE_OPTIONS_BY_TYPE.
 */

import type { SearchDocType } from './filter-model';
import type { GlobalSearchTab } from './search-tabs';

export type SortBy = 'relevance' | 'newest' | 'oldest';

export const DEFAULT_SORT_BY: SortBy = 'relevance';
/** Empty string = use CAC / tab default (`default_native` on mobile). */
export const DEFAULT_RANK_PROFILE = '';
export const FALLBACK_DEFAULT_RANK_PROFILE = 'default_native';

export const SORT_OPTIONS: ReadonlyArray<{ value: SortBy; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

export type RankProfileOption = { value: string; label: string };

/**
 * Explicit rank-profile picks per Vespa schema set. Channels / people have none
 * (local Zero). `getRankProfileOptions` prepends the default `value: ''` row.
 */
const RANK_PROFILE_OPTIONS_BY_TYPE: Partial<Record<SearchDocType, RankProfileOption[]>> = {
  all: [
    { value: 'default_native', label: 'default_native' },
    { value: 'personalized', label: 'personalized' },
    { value: 'default_fuzzy', label: 'default_fuzzy' },
    { value: 'unified', label: 'unified' },
  ],
  messages: [
    { value: 'default_native', label: 'default_native' },
    { value: 'personalized', label: 'personalized' },
    { value: 'default_random', label: 'default_random' },
    { value: 'default_fuzzy', label: 'default_fuzzy' },
    ...Array.from({ length: 23 }, (_, i) => ({
      value: `default_native_${i}`,
      label: `default_native_${i}`,
    })),
  ],
  files: [
    { value: 'default_native', label: 'default_native' },
    { value: 'personalized', label: 'personalized' },
    { value: 'default_fuzzy', label: 'default_fuzzy' },
  ],
  tickets: [
    { value: 'default_native', label: 'default_native' },
    { value: 'personalized', label: 'personalized' },
    { value: 'default_fuzzy', label: 'default_fuzzy' },
    { value: 'semantic_ranking', label: 'semantic_ranking' },
  ],
  desk: [
    { value: 'default_native', label: 'default_native' },
    { value: 'personalized', label: 'personalized' },
    { value: 'default_fuzzy', label: 'default_fuzzy' },
    { value: 'global_sorted', label: 'global_sorted' },
    { value: 'default_bm25', label: 'default_bm25' },
    { value: 'default_ai', label: 'default_ai' },
  ],
};

/**
 * DocType used for Rank options on the active mobile tab.
 * Chats / Channels are local lists, but Rank still offers message profiles so the
 * pick carries over when the user switches to Messages.
 */
export function rankDocTypeForTab(tab: GlobalSearchTab): SearchDocType {
  switch (tab) {
    case 'tickets':
      return 'tickets';
    case 'files':
      return 'files';
    case 'messages':
    case 'calls':
    case 'chats':
    case 'channels':
      return 'messages';
  }
}

export function defaultRankProfileForTab(_tab: GlobalSearchTab): string {
  return FALLBACK_DEFAULT_RANK_PROFILE;
}

export function getRankProfileOptions(
  tab: GlobalSearchTab,
  resolvedDefault: string = defaultRankProfileForTab(tab),
): RankProfileOption[] {
  const docType = rankDocTypeForTab(tab);
  const explicit = RANK_PROFILE_OPTIONS_BY_TYPE[docType];
  if (!explicit) return [];
  return [
    { value: '', label: resolvedDefault },
    ...explicit.filter(option => option.value !== resolvedDefault),
  ];
}

export function sortLabel(sortBy: SortBy): string {
  return SORT_OPTIONS.find(option => option.value === sortBy)?.label ?? 'Relevance';
}

export function rankLabel(tab: GlobalSearchTab, rankProfile: string): string {
  const options = getRankProfileOptions(tab);
  const match = options.find(option => option.value === rankProfile);
  if (match) return match.label;
  if (rankProfile) return rankProfile;
  return defaultRankProfileForTab(tab);
}

/** Profile sent to Vespa: explicit pick, else tab default. */
export function effectiveRankProfile(tab: GlobalSearchTab, rankProfile: string): string {
  return rankProfile || defaultRankProfileForTab(tab);
}

export function isSortActive(sortBy: SortBy): boolean {
  return sortBy !== DEFAULT_SORT_BY;
}

export function isRankActive(rankProfile: string): boolean {
  return rankProfile !== DEFAULT_RANK_PROFILE;
}
