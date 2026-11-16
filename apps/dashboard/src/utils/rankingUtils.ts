import { tierOf, type ChannelSearchItem, type RankedCandidate } from '@xyne/shared/utils';
import { affinityService } from '../services/affinityService';
import { isDMChannel } from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { isUserDeactivated } from './userDisplayName';

/**
 * Pure user/channel search-ranking functions, extracted from `useSearchMetrics` (which is a large
 * telemetry hook these had nothing to do with). Layer above the primitives: `searchUsers`/
 * `searchChannels` generate candidates; these order them by relevance + MFU affinity + recency.
 * Consumed by `useRankedPeopleSearch`, the cmd+K menu, slash pickers, Compose, Forward, and DM search.
 */

// Cmd+K user/channel ranking lives in @xyne/shared so the mobile app's global search orders
// results the same way. It reads MFU affinity from the app's registered AffinityService (this
// app's singleton, registered in services/affinityService).
export {
  buildCmdkChannelGroups,
  filterChannelsBySearchableNames,
  rankChannelsByAffinity,
  rankUsers,
  rankUsersWithMfu,
} from '@xyne/shared/utils';

/** The shape every Cmd+K channel/DM candidate arrives in. Defined in @xyne/shared. */
export type { ChannelSearchItem };

/**
 * Names a DM is MATCHED on: the search-only superset (displayName + raw name) when present.
 * `??` not `||`, so a caller cannot blank the fallback with an empty array.
 */
const matchNamesOf = (item: ChannelSearchItem): string[] =>
  item.searchNames ?? item.searchableNames ?? [];

/* ------------------------------------------------------------------------------------
 * Global-phase candidates
 *
 * These do NOT search. They tag the lists the palette already computed with a shared tier so
 * one merge can interleave them — same rows, one order instead of three.
 *
 * `score` is the entry's index in its source list, so the source's own order is the
 * within-tier tie-break. Deriving a score here would be a second matcher, and folding in
 * affinity would double-count it: the merge applies affinity once, across all sources.
 * ---------------------------------------------------------------------------------- */

/** Names a person should be matched on: display name first, raw name when it differs. */
const userMatchNames = (user: { name: string; displayName?: string | null }): string[] =>
  user.displayName && user.displayName !== user.name ? [user.displayName, user.name] : [user.name];

export function toUserCandidates<
  T extends {
    id: string;
    name: string;
    status?: string | null;
    displayName?: string | null;
    email?: string;
  },
>(users: T[], query: string): RankedCandidate<T>[] {
  return users.map((item, index) => ({
    id: item.id,
    type: 'user' as const,
    tier: tierOf(userMatchNames(item), query, { tokenStartIsPrefix: true }),
    score: index,
    affinity: affinityService.getUserWeight(item.id),
    // Below every active match whatever its tier — same rule rankUsers applies outermost.
    demoted: isUserDeactivated(item),
    item,
  }));
}

/**
 * Tag an already-filtered channel/DM list. Adds a tier; does not search or reorder.
 *
 * WHICH channels reach it is the caller's call: Cmd+K passes regular channels only when
 * searching (group DMs keep their own section, a 1:1 would duplicate the person) and
 * everything including DMs when browsing, where no people rows exist to duplicate.
 */
export function toChannelCandidates<T extends ChannelSearchItem>(
  items: T[],
  query: string,
): RankedCandidate<T>[] {
  // No early return on an empty query: browse needs candidates too, and tierOf puts
  // everything on the top rung, leaving affinity as the sole key — which is what browse wants.
  const searchLower = query.toLowerCase().trim();

  return items.map((item, index) => {
    const { channel } = item;
    const isDm = isDMChannel(channel.scopeType);
    // Same rule as toUserCandidates, so a person ranks alike however they surface.
    const tier = tierOf(isDm ? matchNamesOf(item) : [channel.name], searchLower, {
      tokenStartIsPrefix: true,
    });
    return {
      id: channel.id,
      type: isDm ? ('dm' as const) : ('channel' as const),
      tier,
      score: index,
      affinity: affinityService.getChannelWeight(channel.id),
      item,
    };
  });
}
