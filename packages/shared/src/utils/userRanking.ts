import { ChannelScopeType, UserStatus } from '../zero/types.js';
import type { User } from '../zero/schema.js';
import { matchesAllTokens } from './tokenMatch.js';

/**
 * People search ranking shared by the dashboard (Cmd+K, pickers) and the mobile app's global
 * search and New DM picker. Moved verbatim from the dashboard (`utils/rankingUtils.ts`,
 * `utils/userDisplayName.ts`, the Cmd+K DM-contact map in `ChannelCommandMenu.tsx`,
 * `hooks/useRankedPeopleSearch.ts`, the self rule in `ComposeDmPanel.tsx`) except that MFU
 * affinity is passed in as `getUserWeight`: each app owns its own `AffinityService`.
 */

/** MFU (affinity) weight for a user id. 0 when unknown or personalization is off. */
export type UserWeightLookup = (userId: string) => number;

const NO_WEIGHT: UserWeightLookup = () => 0;

/**
 * Check if a user is deactivated (status is INACTIVE)
 */
function isUserDeactivated(
  user:
    | {
        status?: UserStatus | string | null;
      }
    | undefined
    | null,
): boolean {
  if (!user) return false;
  return user.status === UserStatus.INACTIVE;
}

/**
 * Shared predicate for filtering users by a typed query — the standard the cmd+K / DM matchers use.
 * Matches BOTH `displayName` AND raw `name` (so a full-name query still hits a user whose displayName
 * is a short nickname), with `matchesAllTokens` for out-of-order / partial tokens; email stays a
 * whole-query substring match. Empty query matches everyone.
 */
export function matchesUserQuery(
  user: { name?: string | null; displayName?: string | null; email?: string | null },
  query: string,
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  // Match displayName OR raw name independently — all tokens must appear within one of them, so a
  // nickname displayName and the full name are each searchable. Only run the displayName pass when
  // it's non-empty and distinct from name. Email is a whole-query substring.
  const name = user.name ?? '';
  return (
    matchesAllTokens(name, trimmed) ||
    (!!user.displayName &&
      user.displayName !== name &&
      matchesAllTokens(user.displayName, trimmed)) ||
    (user.email?.toLowerCase().includes(trimmed.toLowerCase()) ?? false)
  );
}

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
>(
  users: T[],
  query: string,
  dmContactRecency: Map<string, number>,
  getUserWeight: UserWeightLookup = NO_WEIGHT,
): T[] {
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
  const mfuWeight = new Map(users.map(u => [u.id, getUserWeight(u.id)] as const));

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
>(
  candidates: T[],
  allUsers: T[],
  query: string,
  dmContactRecency: Map<string, number>,
  getUserWeight: UserWeightLookup = NO_WEIGHT,
): T[] {
  const inCandidates = new Set(candidates.map(u => u.id));
  // Recover weighted users the query matches — same matchesUserQuery the pickers use (token-AND on
  // name/displayName so reordered matches like "prasad siva" recover, plus email substring).
  const weightedExtras = allUsers.filter(
    u => !inCandidates.has(u.id) && getUserWeight(u.id) > 0 && matchesUserQuery(u, query),
  );
  return rankUsers([...candidates, ...weightedExtras], query, dmContactRecency, getUserWeight);
}

export const isDMChannel = (scopeType: ChannelScopeType): boolean => {
  return scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;
};

const isOneToOneDMChannel = (scopeType?: ChannelScopeType): boolean => {
  return scopeType === ChannelScopeType.DM;
};

/**
 * Parse participant IDs from DM/Group DM channel name
 * Channel.name format: "userId1,userId2,userId3" (sorted)
 */
export const parseDMParticipantIds = (channel: {
  name: string;
  scopeType: ChannelScopeType;
}): string[] => {
  if (!isDMChannel(channel.scopeType)) {
    return [];
  }
  return channel.name.split(',').filter(Boolean);
};

/**
 * Dashboard Cmd+K's DM-contact map: each 1:1 DM partner mapped to their position in
 * `directMessages` (0 = first) — the `dmContactRecency` input to `rankUsers`. Callers pass the
 * DM list in Cmd+K's sidebar order: open, non-starred DMs, most-used first, then most recent.
 */
export function buildDmContactRecency(
  directMessages: ReadonlyArray<{ name: string; scopeType: ChannelScopeType }>,
  currentUserID: string,
): Map<string, number> {
  const map = new Map<string, number>();
  directMessages.forEach(channel => {
    if (isOneToOneDMChannel(channel.scopeType)) {
      const participants = parseDMParticipantIds(channel);
      const otherUserId = participants.find(id => id !== currentUserID);
      if (otherUserId && !map.has(otherUserId)) map.set(otherUserId, map.size);
    }
  });
  return map;
}

/**
 * Map of 1:1 DM partner id → recency index (0 = most recent), from visible DM channels.
 * `rankUsers` reads it as the "frequent contact" signal and DM-recency tie-break.
 */
export function buildVisibleDmContactRecency(
  visibleChannels: ReadonlyArray<{
    name: string;
    scopeType: ChannelScopeType;
    channelStats?: { lastActivityAt?: number | null } | null | undefined;
  }>,
  currentUserId: string,
): Map<string, number> {
  const oneToOne = [...visibleChannels]
    .filter(ch => ch.scopeType === ChannelScopeType.DM)
    .sort((a, b) => (b.channelStats?.lastActivityAt ?? 0) - (a.channelStats?.lastActivityAt ?? 0));
  const map = new Map<string, number>();
  for (const ch of oneToOne) {
    const otherId = ch.name.split(',').find(id => id && id !== currentUserId);
    if (otherId && !map.has(otherId)) map.set(otherId, map.size);
  }
  return map;
}

export interface RankedPeopleOptions {
  /** Recovery pool for MFU recovery (default: active users). Slash passes `allUsers` to stay exact. */
  recoveryPool?: User[] | undefined;
  /** DM-recency map override (default: `useDmContactRecency`). Slash passes its parent-built map. */
  dmContactRecency?: Map<string, number> | undefined;
  /** Drop from candidates AND recovery pool — slash `/call` self-exclusion. */
  excludeUserId?: string | undefined;
  /** Inject at rest so a self-DM stays reachable when the cap sliced it out — slash `/chat`. */
  ensureUserIdAtRest?: string | undefined;
  /** Seed DM contacts into the empty-query candidate set so the browse state shows recent partners. */
  seedDmContactsAtRest?: boolean | undefined;
  /** Substring fallback when Fuse returns nothing (1-char / gapped 2-char queries). */
  substringFallback?: boolean | undefined;
}

/**
 * Active-user candidates (`searchCandidates`: `useActiveUserSearch`, which already embeds the
 * `matchesAllTokens` recall pass) ranked by `rankUsersWithMfu` (relevance tier → MFU affinity →
 * DM recency). The dashboard's `useRankedActivePeople` recipe; `defaultRecency` is its
 * `useDmContactRecency` map (`buildVisibleDmContactRecency`).
 *
 * The "rich" behaviors (`seedDmContactsAtRest`, `substringFallback`) default ON for the picker
 * surfaces; slash pickers turn them off and pass the override opts so the swap is a no-op.
 */
export function rankActivePeople(
  query: string,
  limit: number,
  activeUsers: User[],
  searchCandidates: User[],
  defaultRecency: Map<string, number>,
  opts: RankedPeopleOptions = {},
  getUserWeight: UserWeightLookup = NO_WEIGHT,
): User[] {
  const {
    recoveryPool,
    dmContactRecency,
    excludeUserId,
    ensureUserIdAtRest,
    seedDmContactsAtRest = true,
    substringFallback = true,
  } = opts;

  const trimmed = query.trim();
  const pool = recoveryPool ?? activeUsers;
  const recency = dmContactRecency ?? defaultRecency;

  // Fuse ignores <2-char and single-token queries; fall back to matchesUserQuery over the pool
  // (same matcher the pickers use) so short keystrokes still match.
  let candidates: User[] =
    substringFallback && trimmed.length > 0 && searchCandidates.length === 0
      ? pool.filter(u => matchesUserQuery(u, trimmed)).slice(0, limit)
      : searchCandidates;

  // `/call`: self can't be a target — remove from candidates and the recovery pool so
  // rankUsersWithMfu can't float a weighted self back in.
  let effectivePool = pool;
  if (excludeUserId) {
    candidates = candidates.filter(u => u.id !== excludeUserId);
    effectivePool = pool.filter(u => u.id !== excludeUserId);
  }

  // At rest, seed the recent DM partners so the browse list mirrors "people you talk to".
  // Build a new array — `candidates` may be the memoized useActiveUserSearch result; mutating it
  // would corrupt that memo across renders.
  if (!trimmed && seedDmContactsAtRest) {
    const byId = new Map(effectivePool.map(u => [u.id, u]));
    const present = new Set(candidates.map(u => u.id));
    const seeds: User[] = [];
    for (const id of recency.keys()) {
      if (present.has(id)) continue;
      const u = byId.get(id);
      if (u) {
        seeds.push(u);
        present.add(id);
      }
    }
    if (seeds.length > 0) candidates = [...candidates, ...seeds];
  }

  // `/chat`: inject self at rest so the self-DM stays reachable (ranked, not pinned).
  if (!trimmed && ensureUserIdAtRest && !candidates.some(u => u.id === ensureUserIdAtRest)) {
    const self = effectivePool.find(u => u.id === ensureUserIdAtRest);
    if (self) candidates = [...candidates, self];
  }

  return rankUsersWithMfu(candidates, effectivePool, query, recency, getUserWeight);
}

/**
 * The New DM picker's people (dashboard `ComposeDmPanel`): `rankedPeople` from
 * `rankActivePeople`, with the self rules. Drop self, then prepend it only for a query that is
 * "self" or matches the current user's name (self is never shown in the empty browse state).
 */
export function composeDmPeople(
  rankedPeople: User[],
  searchValue: string,
  currentUserId: string,
  usersById: ReadonlyMap<string, User>,
): User[] {
  const others = rankedPeople.filter(u => u.id !== currentUserId).slice(0, 10);

  const trimmed = searchValue.trim();
  const currentUser = usersById.get(currentUserId);
  if (trimmed && currentUser) {
    const isSelfSearch = trimmed.toLowerCase() === 'self';
    const nameMatches = rankedPeople.some(u => u.id === currentUserId);
    if (isSelfSearch || nameMatches) {
      return [currentUser, ...others].slice(0, 10);
    }
  }
  return others;
}
