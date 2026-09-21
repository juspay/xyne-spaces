import { matchesAllTokens } from './tokenMatch.js';

/**
 * Shared match-quality tier, so people and channels can share one ranked list.
 *
 * Their Fuse scores can't be shared — separate matchers, corpora and thresholds.
 * How something matched can be. See docs/cmdk-search-ranking.md §15.
 */

/**
 * Lower is better: prefix → word start → all tokens → substring → fuzzy.
 * An exact match lands on PREFIX — upstream boosts both -10.
 */
export type Tier = 0 | 1 | 2 | 3 | 4;

const TIER_PREFIX: Tier = 0;
const TIER_WORD_START: Tier = 1;
const TIER_ALL_TOKENS: Tier = 2;
const TIER_SUBSTRING: Tier = 3;
/** Exported: the merge treats this rung differently — see mergeRankedCandidates. */
export const TIER_FUZZY: Tier = 4;

/** Applied to both sides — an asymmetric normalization silently stops matching. */
const normalize = (value: string): string =>
  value.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Best (lowest) tier any of `names` reaches against `query`.
 *
 * `names` identifies the entity: `[displayName, name]` for a person, `[channelName]` for a
 * channel. Empty query → top rung, leaving affinity to order everything.
 *
 * @param options.tokenStartIsPrefix  Any token start counts as a prefix, so "barai" ranks
 *   level with "samit" for Samit Barai. On for the Cmd+K merged list; off by default, which
 *   mirrors the -10 / -5 split `searchUsers` and `searchChannelsWithScores` apply.
 */
export function tierOf(
  names: readonly string[],
  query: string,
  options: { tokenStartIsPrefix?: boolean } = {},
): Tier {
  const q = normalize(query);
  if (!q) return TIER_PREFIX;

  const wordStartTier = options.tokenStartIsPrefix ? TIER_PREFIX : TIER_WORD_START;
  let best: Tier = TIER_FUZZY;

  // Best across ALL names, not the first that matches: for ["Prajwal Prasad", "Prasad"]
  // returning early would report the surname and hide the prefix.
  for (const raw of names) {
    const name = normalize(raw);
    if (!name) continue;
    if (name.startsWith(q)) return TIER_PREFIX;
    if (name.includes(' ' + q) && wordStartTier < best) best = wordStartTier;
  }
  if (best <= TIER_WORD_START) return best;

  // The rungs below search one joined haystack, so a multi-token query can be satisfied by
  // the display name and the raw name together.
  const haystack = names.map(normalize).filter(Boolean).join(' ');
  const isMultiToken = q.split(/[\s,]+/).filter(Boolean).length > 1;

  if (isMultiToken && matchesAllTokens(haystack, q)) return TIER_ALL_TOKENS;
  if (haystack.includes(q)) return TIER_SUBSTRING;
  return TIER_FUZZY;
}
