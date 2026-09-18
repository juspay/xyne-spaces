import { TIER_FUZZY, type Tier } from './searchTier.js';

/**
 * Merges the separately-ranked candidate lists into one order: people and channels when
 * searching, every conversation when browsing. Phase 1 (the existing hooks) is untouched —
 * this only decides how they interleave. See docs/cmdk-search-ranking.md §15.
 */

export type CandidateType = 'user' | 'dm' | 'channel';

export interface RankedCandidate<T> {
  id: string;
  type: CandidateType;
  tier: Tier;
  /** Source's own order/score, lower = better. Compared only within its (tier, type). */
  score: number;
  /** Raw server weight, 0-100. */
  affinity: number;
  /** Below everything whatever its tier — deactivated users. */
  demoted?: boolean;
  item: T;
}

/** 50 → 0.5, 100 → 0.705. The server caps weight at 100, so 0.705 is the real ceiling. */
export const saturateAffinity = (weight: number): number => (2 / Math.PI) * Math.atan(weight / 50);

/** Reached only on a dead tie: people beat channels. */
const TYPE_PRIOR: Record<CandidateType, number> = { user: 0, dm: 1, channel: 2 };

const bucketKey = (c: RankedCandidate<unknown>): string => `${c.tier}:${c.type}`;

/**
 * Sort keys: demoted, tier, affinity, normalized score, type.
 *
 * In TIER_FUZZY affinity and score swap. Other tiers say HOW something matched, so their
 * members are equally relevant and affinity is the right tie-break; the fuzzy rung says only
 * "no structural match", and the real relevance is the source's Fuse score. Ordering it by
 * affinity put Mamtha level with "Harika Matam" for the query "mamta".
 *
 * Callers must over-fetch: sources cap independently, so merging their caps lets the
 * loosest-capped type win on volume alone.
 */
export function mergeRankedCandidates<T>(
  lists: ReadonlyArray<ReadonlyArray<RankedCandidate<T>>>,
  limit: number,
): RankedCandidate<T>[] {
  const all: RankedCandidate<T>[] = [];
  for (const list of lists) all.push(...list);
  if (all.length === 0) return [];

  // Normalize scores within a (tier, type) bucket only — across buckets they are three
  // differently-tuned matchers and not comparable.
  const bounds = new Map<string, { lo: number; hi: number }>();
  for (const c of all) {
    const seen = bounds.get(bucketKey(c));
    if (!seen) {
      bounds.set(bucketKey(c), { lo: c.score, hi: c.score });
      continue;
    }
    if (c.score < seen.lo) seen.lo = c.score;
    if (c.score > seen.hi) seen.hi = c.score;
  }

  // Decorate-sort-undecorate: the comparator must not call affinityService, whose getters
  // trigger a background refetch on a stale cache.
  const decorated = all.map(candidate => {
    const { lo, hi } = bounds.get(bucketKey(candidate))!;
    const span = hi - lo;
    return {
      candidate,
      demoted: candidate.demoted === true ? 1 : 0,
      affinity: saturateAffinity(candidate.affinity),
      normalized: span > 0 ? (candidate.score - lo) / span : 0,
      prior: TYPE_PRIOR[candidate.type],
    };
  });

  decorated.sort((a, b) => {
    const byDemoted = a.demoted - b.demoted;
    if (byDemoted !== 0) return byDemoted;

    const byTier = a.candidate.tier - b.candidate.tier;
    if (byTier !== 0) return byTier;

    // Tiers are equal here, so both are fuzzy or neither is.
    if (a.candidate.tier === TIER_FUZZY) {
      return a.normalized - b.normalized || b.affinity - a.affinity || a.prior - b.prior;
    }
    return b.affinity - a.affinity || a.normalized - b.normalized || a.prior - b.prior;
  });

  return decorated.slice(0, limit).map(entry => entry.candidate);
}
