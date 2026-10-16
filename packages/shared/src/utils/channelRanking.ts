import Fuse from 'fuse.js';
import type { Channel } from '../zero/schema.js';
import { ChannelScopeType } from '../zero/types.js';
import { saturateAffinity } from './globalPhase.js';
import { searchChannelsWithScores } from './search.js';

/**
 * Channel / DM search ranking shared by the dashboard (Cmd+K, `in:` / `#` typeahead, pickers)
 * and the mobile app's global search. Moved verbatim from the dashboard's `utils/rankingUtils.ts`
 * except that channel affinity is passed in as `getChannelWeight`: each app owns its own
 * `AffinityService`.
 */

/** Affinity (MFU) weight for a channel id. 0 when unknown or personalization is off. */
export type ChannelWeightLookup = (channelId: string) => number;

const NO_WEIGHT: ChannelWeightLookup = () => 0;

const isDMChannel = (scopeType: ChannelScopeType): boolean => {
  return scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;
};

// Squashes raw affinity into [0, 1) with diminishing returns: 50 → 0.5, 100 → 0.705.
// Shared with the global-phase merge so both paths agree on what a weight is worth; the
// server caps raw weight at 100, so 0.705 is the ceiling in practice.
const sat = saturateAffinity;

// A single Fuse doc: one participant name tagged with the DM channel it belongs
// to. We index every DM participant name into ONE Fuse instance instead of
// building a separate Fuse per DM channel.
type DmParticipantDoc = { channelId: string; name: string };

const DM_FUSE_OPTIONS = {
  threshold: 0.35,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 1,
  keys: ['name'],
};

// Single-slot memo for the combined DM Fuse index. The set of DMs (and their
// participant names) is stable across keystrokes within a typing session, so
// we build the index once and reuse it for every keystroke — the previous
// per-DM approach constructed one Fuse per DM on EVERY keystroke and, with an
// LRU capped at 50, provided zero reuse for users with more than 50 DMs.
// Fuse computes a per-item (query, string) score independently of the rest of
// the corpus, so grouping the best match per channel out of one shared index
// yields the SAME score per DM as a per-DM index did.
let _dmFuse: { sig: string; fuse: Fuse<DmParticipantDoc> } | null = null;

function getDmFuse(docs: DmParticipantDoc[], sig: string): Fuse<DmParticipantDoc> {
  if (!_dmFuse || _dmFuse.sig !== sig) {
    _dmFuse = { sig, fuse: new Fuse(docs, DM_FUSE_OPTIONS) };
  }
  return _dmFuse.fuse;
}

// Cache docs+sig by `items` array identity: callers whose items are referentially stable
// (e.g. useDmsSearch's hoisted groupItems) rebuild them only when the DM set changes.
const _dmDocsCache = new WeakMap<
  ReadonlyArray<unknown>,
  { docs: DmParticipantDoc[]; sig: string }
>();

function getDmDocsForItems<
  T extends { channel: Channel; searchableNames?: string[]; searchNames?: string[] },
>(items: ReadonlyArray<T>, dmItems: T[]): { docs: DmParticipantDoc[]; sig: string } {
  const cached = _dmDocsCache.get(items);
  if (cached) return cached;
  const docs: DmParticipantDoc[] = [];
  for (const item of dmItems) {
    // Prefer the search-only superset (displayName + raw name) when present; regular channels and
    // callers without it fall back to searchableNames. `??` (not `||`) so a caller can't accidentally
    // blank the fallback with an empty array — searchNames is only ever set (non-empty) on DM items.
    const names = item.searchNames ?? item.searchableNames;
    if (!names) continue;
    for (const name of names) docs.push({ channelId: item.channel.id, name });
  }
  const sig = docs.map(d => d.channelId + '\x1f' + d.name).join('\x1e');
  _dmDocsCache.set(items, { docs, sig });
  return { docs, sig };
}

// Affinity weight for DM ranking. Fuse scores are [0, 1]; 0.5 means peak
// affinity shifts a result by half the score range.
const AFFINITY_WEIGHT = 0.5;

// Affinity weight for regular channel ranking. searchChannelsWithScores
// applies −10/−5 prefix boosts, so the score range is ~[−10, 0.3].
// At W=10, sat(affinity)×10 equals the 5-point tier gap when affinity
// hits the sat() midpoint (50), so regularly-used channels (affinity≥50)
// can surface above a lower-affinity prefix match. Fuzzy matches need
// affinity≫1000 to cross the 10-point prefix gap — effectively never.
const REGULAR_CHANNEL_AFFINITY_WEIGHT = 10;

/**
 * Rank channels/DMs by personalization weight (desc), tie-break on recency
 * (`channelStats.lastActivityAt`). Mirrors the empty-browse ordering used by the
 * Cmd+K channel groups so the `/chat`/`/call` pickers surface the same
 * most-used conversations first.
 *
 * Weights are precomputed into a Map up front — never call `getChannelWeight`
 * inside the comparator, since its stale-cache background refetch would re-check
 * on every comparison. No weights → all-0 ties → pure recency, i.e. the incoming
 * order is preserved. `channelStats` is optional so base `Channel` lists (no
 * relation loaded) degrade to weight-only, while `VisibleChannel` lists keep the
 * recency tie-break.
 */
export function rankChannelsByAffinity<
  T extends {
    id: string;
    // `| undefined` is required: VisibleChannel's channelStats is a Zero `one()` relation typed
    // `{…} | undefined`, which exactOptionalPropertyTypes rejects for a plain optional field.
    channelStats?: { lastActivityAt?: number | null } | null | undefined;
  },
>(channels: T[], getChannelWeight: ChannelWeightLookup = NO_WEIGHT): T[] {
  const weightById = new Map(channels.map(c => [c.id, getChannelWeight(c.id)] as const));
  return [...channels].sort((a, b) => {
    const wa = weightById.get(a.id) ?? 0;
    const wb = weightById.get(b.id) ?? 0;
    if (wa !== wb) return wb - wa;
    return (b.channelStats?.lastActivityAt ?? 0) - (a.channelStats?.lastActivityAt ?? 0);
  });
}

/** The shape every Cmd+K channel/DM candidate arrives in. */
export type ChannelSearchItem = {
  channel: Channel;
  searchableNames?: string[];
  searchNames?: string[];
};

/**
 * Filter channel entries for Cmd+K search.
 *
 * DMs/Group DMs match against `searchableNames` (participant display names)
 * with AND-semantics: every comma/whitespace-separated token must match some
 * participant. Regular channels defer to `searchChannels` for fuzzy +
 * hyphen-strip behaviour shared with the rest of the app.
 *
 * Cmd+K-scoped (the participant-name match path is specific to the command
 * menu's grouped layout). Used by `filteredLocalChannels` below and by the
 * `in:` / `#` typeahead in ChannelCommandMenu.
 *
 * @param options.excludeDMs  Drop DMs/Group DMs entirely — used by the `#`
 *   Slack-style quick switcher which should show only regular channels.
 * @param options.regularFuseMatches  Regular-channel matches already computed in a web worker.
 * @param options.getChannelWeight  Channel affinity (MFU) weight; omitted = no affinity.
 */
export function filterChannelsBySearchableNames<
  T extends { channel: Channel; searchableNames?: string[]; searchNames?: string[] },
>(
  items: T[],
  query: string,
  options: {
    excludeDMs?: boolean;
    regularFuseMatches?: ReadonlyArray<{ id: string; score?: number | undefined }>;
    getChannelWeight?: ChannelWeightLookup;
  } = {},
): T[] {
  const getChannelWeight = options.getChannelWeight ?? NO_WEIGHT;
  const scoped = options.excludeDMs
    ? items.filter(({ channel }) => !isDMChannel(channel.scopeType))
    : items;

  const searchLower = query.toLowerCase().trim();
  if (!searchLower) return scoped;

  const dmItems = scoped.filter(({ channel }) => isDMChannel(channel.scopeType));
  const regularItems = scoped.filter(({ channel }) => !isDMChannel(channel.scopeType));

  const queryParts = searchLower
    .split(/[,\s]+/)
    .map(p => p.trim())
    .filter(Boolean);

  // Build ONE Fuse index over every DM participant name (tagged with its
  // channel) and search it once per query token, instead of building a fresh
  // Fuse per DM and searching each one per token. For P tokens and N DMs this
  // turns O(N) index constructions + O(N*P) searches per keystroke into a
  // cached single construction + O(P) searches.
  const { docs: dmDocs, sig } =
    dmItems.length > 0 ? getDmDocsForItems(scoped, dmItems) : { docs: [], sig: '' };

  let matchedDms: T[] = [];
  if (dmItems.length > 0 && queryParts.length > 0 && dmDocs.length > 0) {
    // Signature is stable across keystrokes for a fixed DM set, so the index is
    // constructed once per session and reused. Keyed on channel id + names.
    const fuse = getDmFuse(dmDocs, sig);

    // For each token, record the best (lowest) Fuse score per channel plus the
    // matched name. Fuse returns results sorted ascending by score, so the FIRST
    // result seen for a channel is that channel's best match for the token —
    // identical to `results[0]` from the old per-DM search.
    const bestPerChannelPerPart = queryParts.map(part => {
      const perChannel = new Map<string, { score: number; matched: string }>();
      for (const { item: doc, score } of fuse.search(part)) {
        if (perChannel.has(doc.channelId)) continue;
        perChannel.set(doc.channelId, { score: score ?? 1, matched: doc.name.toLowerCase() });
      }
      return perChannel;
    });

    matchedDms = dmItems
      .flatMap(item => {
        const channelId = item.channel.id;

        let totalFuseScore = 0;
        for (let i = 0; i < queryParts.length; i++) {
          const best = bestPerChannelPerPart[i]!.get(channelId);
          if (!best) return []; // AND: every token must match some participant
          totalFuseScore += best.matched.startsWith(queryParts[i]!) ? best.score - 0.5 : best.score;
        }

        // Fuse scores are [0, 1] (0 = perfect). Prefix boost subtracts 0.5, making
        // per-part scores potentially negative. Subtraction (not division) is critical:
        // division would make negative scores less negative with high affinity, inverting
        // the ranking. Lower finalScore = better rank.
        const fuseScore = totalFuseScore / queryParts.length;
        const affinity = getChannelWeight(channelId);
        const finalScore = fuseScore - sat(affinity) * AFFINITY_WEIGHT;

        return [{ item, score: finalScore }];
      })
      .sort((a, b) => a.score - b.score) // lower = better
      .map(({ item }) => item);
  }

  const regularChannels = regularItems.map(item => item.channel);
  const regularItemsById = new Map(regularItems.map(item => [item.channel.id, item]));
  const fuseMatches = options.regularFuseMatches?.flatMap(({ id, score }) => {
    const item = regularItemsById.get(id);
    return item ? [{ item: item.channel, score }] : [];
  });

  // searchChannelsWithScores runs the same Fuse fuzzy match + prefix boosts
  // as searchChannels but returns { item, score }[] instead of just items,
  // so we can apply affinity on top before deciding the final order.
  const matchedRegular = searchChannelsWithScores(
    regularChannels,
    query,
    regularChannels.length,
    fuseMatches,
  )
    .flatMap(({ item: channel, score }) => {
      const item = regularItemsById.get(channel.id);
      if (!item) return [];

      const affinity = getChannelWeight(channel.id);
      const finalScore = score - sat(affinity) * REGULAR_CHANNEL_AFFINITY_WEIGHT;

      return [{ item, score: finalScore }];
    })
    .sort((a, b) => a.score - b.score)
    .map(({ item }) => item);

  return [...matchedDms, ...matchedRegular];
}
