import type { ChannelUserStatus } from '../zero/schema.js';
import { ChannelScopeType, ChannelType } from '../zero/types.js';
import type { VisibleChannel } from '../machines/stateMachine.js';
import { isDeskChannelType } from './channel.js';
import { rankChannelsByAffinity, type ChannelWeightLookup } from './channelRanking.js';
import { isDMChannel, parseDMParticipantIds } from './userRanking.js';

/**
 * Which channels and DMs the chat surfaces list, and the names a DM is shown and matched by.
 * Shared by the dashboard (sidebar, Cmd+K, search results, composer menus) and the mobile app's
 * global search. `groupChannelsByScope` and `getDMNames` are moved verbatim from the
 * dashboard's `ChatDirectory.utils.ts`; `buildCmdkChannelGroups` is Cmd+K's channel-groups
 * memo from `GlobalCommandMenu.tsx`, with channel affinity passed in.
 */

export const groupChannelsByScope = (
  channelData: VisibleChannel[],
  allChannelsUserStatus: ChannelUserStatus[],
): {
  starred: VisibleChannel[];
  channels: VisibleChannel[];
  directMessages: VisibleChannel[];
} => {
  const starred: VisibleChannel[] = [];
  const channels: VisibleChannel[] = [];
  const directMessages: VisibleChannel[] = [];
  // Index statuses by channelId once (O(n)) so the per-channel lookup below is
  // O(1) — same pattern used by bucketChannelsBySection. Previously this used
  // `allChannelsUserStatus.find(...)` per channel, giving O(n * m) behaviour.
  const statusByChannelId = new Map<string, ChannelUserStatus>();
  for (const status of allChannelsUserStatus) {
    statusByChannelId.set(status.channelId, status);
  }
  for (const channel of channelData) {
    // SDLC repository channels are system-managed and hidden from the chat
    // sidebar by default, the same way SUPPORT channels are. An explicit star
    // from the user overrides that: the header Star button is available on
    // SDLC channels, so a starred SDLC channel must show under Starred.
    if (channel.type === ChannelType.SDLC) {
      if (statusByChannelId.get(channel.id)?.isStarred) {
        starred.push(channel);
      }
      continue;
    }
    // EMAIL channels live in Xyne Desk, not in the chat directory.
    // TODO: filter this out at the source by excluding EMAIL-type channels in the
    // `visibleChannels` query itself, so the client never receives them here.
    if (isDeskChannelType(channel.type)) {
      continue;
    }

    const currentUserParticipation = statusByChannelId.get(channel.id);

    // Skip closed DMs (soft-deleted by user)
    if (currentUserParticipation?.isClosed && isDMChannel(channel.scopeType)) {
      continue;
    }

    if (currentUserParticipation?.isStarred) {
      starred.push(channel);
      continue; // Don't add to other categories if starred
    }
    if (channel.scopeType === ChannelScopeType.DEFAULT) {
      channels.push(channel);
    } else if (isDMChannel(channel.scopeType)) {
      directMessages.push(channel);
    }
  }

  return { starred, channels, directMessages };
};

/**
 * Resolve a DM's participant names for BOTH display and search in a single pass.
 *
 * - `display`: one name per participant (`displayName || name`) — safe to render.
 * - `search`: superset with both `displayName` AND raw `name` per participant (deduped), so a
 *   full-name query still matches a short-nickname displayName. Feed to
 *   filterChannelsBySearchableNames via `searchNames` — never render it (would duplicate names).
 *
 * Regular channels → `[channel.name]` for both. Self-DM → own name + 'You'. The current user is
 * excluded from multi-participant DMs. Canonical resolver — use everywhere DM names are needed.
 */
export const getDMNames = (
  channel: { name: string; scopeType: ChannelScopeType },
  currentUserId: string,
  usersById: ReadonlyMap<string, { name: string; displayName?: string | null }>,
): { display: string[]; search: string[] } => {
  if (!isDMChannel(channel.scopeType)) {
    return { display: [channel.name], search: [channel.name] };
  }

  const userIds = parseDMParticipantIds(channel);
  const isSelfDM = userIds.length === 1 && userIds[0] === currentUserId;

  if (isSelfDM) {
    const u = usersById.get(currentUserId);
    const preferred = u ? u.displayName || u.name : undefined;
    return {
      display: preferred ? [preferred, 'You'] : ['You'],
      search: [...new Set([u?.displayName, u?.name, 'You'].filter((n): n is string => !!n))],
    };
  }

  const display: string[] = [];
  const search: string[] = [];
  for (const id of userIds) {
    if (id === currentUserId) continue;
    const u = usersById.get(id);
    if (!u) continue;
    const preferred = u.displayName || u.name;
    if (preferred) display.push(preferred);
    if (u.displayName) search.push(u.displayName);
    if (u.name && u.name !== u.displayName) search.push(u.name);
  }
  return { display, search };
};

/**
 * Cmd+K's channel groups (`GlobalCommandMenu`): the catalog merged with the visible channels
 * (preferring the visible copy), grouped by `groupChannelsByScope`, Desk channels re-added to
 * the channel list, and each group ranked by affinity then recent activity.
 */
export function buildCmdkChannelGroups(
  channelData: ReadonlyArray<{ id: string }>,
  visibleAllChannels: ReadonlyArray<VisibleChannel>,
  allChannelsUserStatus: ChannelUserStatus[],
  getChannelWeight: ChannelWeightLookup,
): { starred: VisibleChannel[]; channels: VisibleChannel[]; directMessages: VisibleChannel[] } {
  if (!channelData.length) return { starred: [], channels: [], directMessages: [] };

  // Index visible channels by id once (O(n)); the previous `.find` inside this
  // `.map` was O(n * m) over ~749 all x ~431 visible channels per recompute.
  const visibleById = new Map(visibleAllChannels.map(vc => [vc.id, vc]));
  const visibleChannels = channelData.map(channel => {
    const vc = visibleById.get(channel.id);
    if (vc) {
      return vc;
    }
    return {
      ...channel,
    };
  }) as VisibleChannel[];
  const grouped = groupChannelsByScope(visibleChannels, allChannelsUserStatus);

  // groupChannelsByScope excludes EMAIL channels (they live in Desk, not chat sidebar).
  // Re-include them so the search `in:` picker can scope to desk channels.
  const emailChannels = visibleChannels.filter(c => isDeskChannelType(c.type));

  // Rank each group by personalization weight (desc), tie-break on recency (shared with the
  // `/chat`/`/call` pickers). No weights → 0 ties → pure recency, identical to the previous order.
  const rankedStarred = rankChannelsByAffinity(grouped.starred, getChannelWeight);
  const rankedChannels = rankChannelsByAffinity(
    [...grouped.channels, ...emailChannels],
    getChannelWeight,
  );
  const rankedDirectMessages = rankChannelsByAffinity(grouped.directMessages, getChannelWeight);

  return {
    starred: rankedStarred,
    channels: rankedChannels,
    directMessages: rankedDirectMessages,
  };
}
