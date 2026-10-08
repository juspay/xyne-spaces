import type { Channel } from '../zero/schema.js';
import { ChannelScopeType } from '../zero/types.js';
import { searchChannels, searchChannelsWithScores } from './search.js';
import { tierOf } from './searchTier.js';

/**
 * Rank channels that are eligible for # mentions in message composers.
 *
 * Eligibility is applied before ranking and limiting so non-mentionable channel
 * scopes cannot consume the result cap and hide a valid channel.
 */
export function searchMentionableChannels<T extends Channel>(
  channels: T[],
  query: string,
  limit = 10,
): T[] {
  const eligibleChannels = channels.filter(
    (channel) => channel.scopeType === ChannelScopeType.DEFAULT,
  );

  return searchChannels(eligibleChannels, query, limit);
}

/**
 * Per-channel personalization signals, injected so this stays a pure function.
 *
 * The host app owns both: the dashboard and Lotus reach affinity through different
 * paths, and recency comes from a query only the host has mounted.
 */
export interface ChannelMentionSignals {
  /** Usage weight for a channel; 0 when weights are absent or still loading. */
  getWeight: (channelId: string) => number;
  /**
   * `channel_stats.lastActivityAt`, or undefined when we hold no activity data —
   * which is the case for every channel the user has not joined.
   *
   * MUST NOT be sourced from the `lastActivityAt` column on the channel row: that
   * column is deprecated and is not written when a message is sent, so it holds
   * roughly the creation time. Using it would sort by creation date while claiming
   * to sort by recency.
   */
  getLastActivityAt: (channelId: string) => number | undefined;
}

/** `tierOf`'s normalization, applied to a channel name so the two agree. */
const normalizeForTier = (value: string): string =>
  value.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Rank `#`-mention candidates by how much the user actually uses each channel.
 *
 * Ranks the WHOLE eligible pool before applying `limit`, which is the fix this
 * exists for: `searchChannels` cuts first — on an empty query it returns
 * `channels.slice(0, limit)` in whatever order the channel list happens to be
 * stored in — so a most-used channel sitting past the cap was never ranked at all
 * and could not be recovered by re-sorting the result.
 *
 * Empty query: usage weight, then last activity, then name A→Z. The name key
 * matters because a channel the user has not joined has no activity data, so all
 * of those tie and would otherwise keep arbitrary store order.
 *
 * Typed query: a hard match tier, with usage as a tie-break WITHIN a tier only.
 * `searchChannelsWithScores` still decides which channels match (keeping the fuzzy
 * and typo tolerance from XYNE-64482); its score only breaks ties below usage.
 * Tiers rather than an additive blend on purpose: with additive boosts, a word-start
 * match (−5) plus a full affinity term (−7.05) reaches −12.05 and sinks a
 * zero-affinity prefix match at −10 — i.e. typing a channel's own prefix could put a
 * different channel first, which is the failure this ordering exists to prevent.
 *
 * Kept separate from `searchMentionableChannels` rather than folded into it, so the
 * matcher and its tests stay untouched.
 */
export function rankMentionableChannels<T extends Channel>(
  channels: T[],
  query: string,
  limit: number,
  signals: ChannelMentionSignals,
): T[] {
  // Same eligibility rule `searchMentionableChannels` applies, repeated rather than
  // extracted so that function and its tests stay exactly as XYNE-64482 left them.
  const pool = channels.filter((channel) => channel.scopeType === ChannelScopeType.DEFAULT);

  if (!query.trim()) {
    // Read weights once up front, never inside the comparator: a stale read there
    // would trigger the service's background refetch on every comparison.
    const weightById = new Map(pool.map((c) => [c.id, signals.getWeight(c.id)] as const));
    const activityById = new Map(
      pool.map((c) => [c.id, signals.getLastActivityAt(c.id) ?? 0] as const),
    );

    return [...pool]
      .sort((a, b) => {
        const wa = weightById.get(a.id) ?? 0;
        const wb = weightById.get(b.id) ?? 0;
        if (wa !== wb) return wb - wa;
        const ra = activityById.get(a.id) ?? 0;
        const rb = activityById.get(b.id) ?? 0;
        if (ra !== rb) return rb - ra;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);
  }

  const byId = new Map(pool.map((c) => [c.id, c] as const));
  const normalizedQuery = normalizeForTier(query);

  return searchChannelsWithScores(pool, query, pool.length)
    .flatMap(({ item, score }) => {
      const channel = byId.get(item.id);
      if (!channel) return [];
      // tierOf folds exact into TIER_PREFIX (both are −10 upstream); shift its rungs
      // down one so an exactly-typed name outranks a mere prefix of it.
      const isExact = normalizeForTier(item.name) === normalizedQuery;
      return [
        {
          channel,
          tier: isExact ? 0 : tierOf([item.name], query) + 1,
          weight: signals.getWeight(item.id),
          score,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.tier - b.tier || // 1. match quality — never crossed by usage
        b.weight - a.weight || // 2. most-used first within the rung
        a.score - b.score || // 3. the matcher's own relevance
        a.channel.name.localeCompare(b.channel.name),
    )
    .slice(0, limit)
    .map(({ channel }) => channel);
}
