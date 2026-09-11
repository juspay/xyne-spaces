import Fuse from 'fuse.js';
import type { Channel } from '@xyne/shared';
import { affinityService } from '../services/affinityService';
import { searchChannelsWithScores } from '../hooks/useChannels';
import { isDMChannel } from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { isUserDeactivated, matchesUserQuery } from './userDisplayName';

/**
 * Pure user/channel search-ranking functions, extracted from `useSearchMetrics` (which is a large
 * telemetry hook these had nothing to do with). Layer above the primitives: `searchUsers`/
 * `searchChannels` generate candidates; these order them by relevance + MFU affinity + recency.
 * Consumed by `useRankedPeopleSearch`, the cmd+K menu, slash pickers, Compose, Forward, and DM search.
 */

// Squashes raw affinity into [0, 1] with diminishing returns.
// At affinity=50 → sat=0.5; at affinity=200 → sat≈0.9.
const sat = (x: number): number => (2 / Math.PI) * Math.atan(x / 50);

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
 * Rank Cmd+K user candidates:
 *   1. active before deactivated — a hard, global demotion: ALL deactivated
 *      users sink below ALL active ones (their own last "bucket"), so reaching
 *      a deactivated user means scrolling past every active match, i.e. past
 *      the "See more" fold of the people section.
 *   2. name-prefix matches (the relevance signal) within each activation group
 *   3. DM-contact users within each tier
 *   4. tie-break by DM recency (smaller index = more recent activity), so
 *      `from:` with no text shows the same people-you-talk-to-most order
 *      that the plain-search empty state shows in the DIRECT MESSAGES
 *      section.
 *
 * `dmContactRecency` maps a user ID to its position in the recency-ordered
 * 1:1 DM list (0 = most recent). Users not in the map fall through to the
 * incoming alphabetical order from `searchUsers`.
 */
export function rankUsers<
  T extends {
    id: string;
    name: string;
    status?: string | null;
    displayName?: string | null;
    email?: string;
  },
>(users: T[], query: string, dmContactRecency: Map<string, number>): T[] {
  const q = query.toLowerCase().trim();

  // Relevance tier per user (the outer sort key), mirroring searchUsers' cascade:
  // 0 prefix, 1 substring, 2 email, 3 fuzzy-only. Empty query → all tier 0.
  const matchBucket = (u: T): number => {
    if (!q) return 0;
    const name = u.name.toLowerCase();
    const display = (u.displayName || u.name).toLowerCase();
    if (display.startsWith(q) || name.startsWith(q)) return 0;
    if (display.includes(q) || name.includes(q)) return 1;
    if (u.email?.toLowerCase().includes(q)) return 2;
    return 3;
  };
  const relevanceBucket = new Map(users.map(u => [u.id, matchBucket(u)] as const));

  // MFU (most-frequently-used) weight per user from the personalization pipeline,
  // read once up front since the comparator runs O(n log n) times. 0 when
  // personalization is off or unsynced, which makes the MFU tier below a no-op.
  const mfuWeight = new Map(users.map(u => [u.id, affinityService.getUserWeight(u.id)] as const));

  // Stable sort (ES2019+) preserves the incoming `searchUsers` order
  // (alphabetical for non-DM users) when all keys tie.
  return [...users].sort((a, b) => {
    // 1. active before deactivated — a hard, global demotion. Deactivated users
    //    are the last "bucket": they always rank below every active match
    //    regardless of relevance, so they land past the "See more" fold and
    //    take a little more effort to reach.
    const aDeactivated = isUserDeactivated(a);
    const bDeactivated = isUserDeactivated(b);
    if (aDeactivated !== bDeactivated) return aDeactivated ? 1 : -1;

    // 2. relevance tier (outer key): prefix (0) < suffix (1) < email (2) < fuzzy (3).
    //    MFU + DM tiers below only reorder WITHIN a tier, never across it.
    const aBucket = relevanceBucket.get(a.id) ?? 3;
    const bBucket = relevanceBucket.get(b.id) ?? 3;
    if (aBucket !== bBucket) return aBucket - bBucket;

    // 3. higher MFU weight first — the primary personalization signal. Sits above
    //    the DM tiers so a frequently-used person outranks a stale DM contact;
    //    weight 0 (no MFU data) falls through to DM recency, preserving DM order
    //    for un-weighted users.
    const aMfu = mfuWeight.get(a.id) ?? 0;
    const bMfu = mfuWeight.get(b.id) ?? 0;
    if (aMfu !== bMfu) return bMfu - aMfu;

    // 4. DM contacts before non-contacts
    const aDM = dmContactRecency.has(a.id);
    const bDM = dmContactRecency.has(b.id);
    if (aDM !== bDM) return aDM ? -1 : 1;

    // 5. more-recent DM first (0 = most recent)
    const aRecency = dmContactRecency.get(a.id);
    const bRecency = dmContactRecency.get(b.id);
    if (aRecency !== undefined && bRecency !== undefined) return aRecency - bRecency;
    return 0;
  });
}

/**
 * Like `rankUsers`, but guarantees MFU-weighted users that match the query are
 * ranked, even when `searchUsers` sliced them out of the candidate window first.
 * `searchUsers` limits *before* ranking, so a frequently-used user can be dropped
 * entirely (e.g. hundreds of same-name matches). This recovers them from
 * `allUsers` (the full workspace list) so the MFU tier in `rankUsers` can float
 * them back up.
 */
export function rankUsersWithMfu<
  T extends {
    id: string;
    name: string;
    status?: string | null;
    displayName?: string | null;
    email?: string;
  },
>(candidates: T[], allUsers: T[], query: string, dmContactRecency: Map<string, number>): T[] {
  const inCandidates = new Set(candidates.map(u => u.id));
  // Recover weighted users the query matches — same matchesUserQuery the pickers use (token-AND on
  // name/displayName so reordered matches like "prasad siva" recover, plus email substring).
  const weightedExtras = allUsers.filter(
    u =>
      !inCandidates.has(u.id) &&
      affinityService.getUserWeight(u.id) > 0 &&
      matchesUserQuery(u, query),
  );
  return rankUsers([...candidates, ...weightedExtras], query, dmContactRecency);
}

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
>(channels: T[]): T[] {
  const weightById = new Map(
    channels.map(c => [c.id, affinityService.getChannelWeight(c.id)] as const),
  );
  return [...channels].sort((a, b) => {
    const wa = weightById.get(a.id) ?? 0;
    const wb = weightById.get(b.id) ?? 0;
    if (wa !== wb) return wb - wa;
    return (b.channelStats?.lastActivityAt ?? 0) - (a.channelStats?.lastActivityAt ?? 0);
  });
}

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
 */
export function filterChannelsBySearchableNames<
  T extends { channel: Channel; searchableNames?: string[]; searchNames?: string[] },
>(items: T[], query: string, options: { excludeDMs?: boolean } = {}): T[] {
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
  const dmDocs: DmParticipantDoc[] = [];
  for (const item of dmItems) {
    // Prefer the search-only superset (displayName + raw name) when present; regular channels and
    // callers without it fall back to searchableNames. `??` (not `||`) so a caller can't accidentally
    // blank the fallback with an empty array — searchNames is only ever set (non-empty) on DM items.
    const names = item.searchNames ?? item.searchableNames;
    if (!names) continue;
    for (const name of names) dmDocs.push({ channelId: item.channel.id, name });
  }

  let matchedDms: T[] = [];
  if (dmItems.length > 0 && queryParts.length > 0 && dmDocs.length > 0) {
    // Signature is stable across keystrokes for a fixed DM set, so the index is
    // constructed once per session and reused. Keyed on channel id + names.
    const sig = dmDocs.map(d => d.channelId + '\x1f' + d.name).join('\x1e');
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
        const affinity = affinityService.getChannelWeight(channelId);
        const finalScore = fuseScore - sat(affinity) * AFFINITY_WEIGHT;

        return [{ item, score: finalScore }];
      })
      .sort((a, b) => a.score - b.score) // lower = better
      .map(({ item }) => item);
  }

  const regularChannels = regularItems.map(item => item.channel);
  const regularItemsById = new Map(regularItems.map(item => [item.channel.id, item]));

  // searchChannelsWithScores runs the same Fuse fuzzy match + prefix boosts
  // as searchChannels but returns { item, score }[] instead of just items,
  // so we can apply affinity on top before deciding the final order.
  const matchedRegular = searchChannelsWithScores(regularChannels, query, regularChannels.length)
    .flatMap(({ item: channel, score }) => {
      const item = regularItemsById.get(channel.id);
      if (!item) return [];

      const affinity = affinityService.getChannelWeight(channel.id);
      const finalScore = score - sat(affinity) * REGULAR_CHANNEL_AFFINITY_WEIGHT;

      return [{ item, score: finalScore }];
    })
    .sort((a, b) => a.score - b.score)
    .map(({ item }) => item);

  return [...matchedDms, ...matchedRegular];
}
