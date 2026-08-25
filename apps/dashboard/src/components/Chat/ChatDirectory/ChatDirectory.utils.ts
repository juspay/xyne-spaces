import {
  ChannelFilterMode,
  ChannelScopeType,
  ChannelSortOrder,
  ChannelType,
  ChannelUserStatus,
  ChannelSection,
  isDeskChannelType,
} from '@xyne/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { VisibleChannel } from '../../../machines/stateMachine';
import type { SectionBucket } from './ChatDirectory.types';

/** `generateKeyBetween` that never throws on legacy/invalid neighbor keys (falls back instead). */
export const keyBetween = (a: string | null, b: string | null): string => {
  try {
    return generateKeyBetween(a, b);
  } catch {
    try {
      return generateKeyBetween(null, b);
    } catch {
      try {
        return generateKeyBetween(a, null);
      } catch {
        return generateKeyBetween(null, null);
      }
    }
  }
};

/** Swallow the one click the browser fires after a drag, so a row-drag doesn't navigate the link. */
export const suppressNextClick = (): void => {
  const handler = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener('click', handler, true);
  };
  window.addEventListener('click', handler, true);
  window.setTimeout(() => window.removeEventListener('click', handler, true), 350);
};

export const sumSectionUnread = (
  channels: VisibleChannel[],
  unreadCounts: Record<string, number>,
  activeChannelId?: string,
): number =>
  channels.reduce(
    (total, channel) =>
      total + (channel.id === activeChannelId ? 0 : (unreadCounts[channel.id] ?? 0)),
    0,
  );

export const DEFAULT_FILTER_MODE = ChannelFilterMode.ACTIVE;
export const DEFAULT_GROUP_SORT_ORDER = ChannelSortOrder.UNREAD;
export const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface ChannelFilterContext {
  unreadCounts: Record<string, number>;
  mentionCounts: Record<string, number>;
  statuses: Map<string, ChannelUserStatus>;
  activeChannelId?: string | undefined;
  now: number;
}

export const applyChannelFilter = (
  channels: VisibleChannel[],
  mode: ChannelFilterMode,
  { unreadCounts, mentionCounts, statuses, activeChannelId, now }: ChannelFilterContext,
): VisibleChannel[] => {
  if (mode === ChannelFilterMode.ALL) return channels;
  const cutoff = now - ACTIVE_WINDOW_MS;
  return channels.filter(channel => {
    if (channel.id === activeChannelId) return true;
    const unread = unreadCounts[channel.id] ?? 0;
    if (mode === ChannelFilterMode.MENTIONS) return (mentionCounts[channel.id] ?? 0) > 0;
    const lastActivity = channel.channelStats?.lastActivityAt ?? 0;
    // Purely age-based, as the label says — an old unread does not keep a channel visible.
    if (mode === ChannelFilterMode.ACTIVE) return lastActivity >= cutoff;
    // UNREADS — same predicate the Unreads inbox uses.
    if (unread > 0) return true;
    if (isDMChannel(channel.scopeType)) return false;
    return lastActivity > (statuses.get(channel.id)?.lastViewedAt ?? 0);
  });
};

// Optimized function to group channels by scope type (single pass)
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
    // SDLC repository channels are system-managed and hidden from chat,
    // the same way SUPPORT channels are.
    if (channel.type === ChannelType.SDLC) {
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

/** Partition default-scope channels into custom sections + the unsectioned remainder. */
export const bucketChannelsBySection = (
  channels: VisibleChannel[],
  allChannelsUserStatus: ChannelUserStatus[],
  sections: readonly ChannelSection[],
): { sectioned: SectionBucket[]; unsectioned: VisibleChannel[] } => {
  const statusByChannelId = new Map<string, ChannelUserStatus>();
  for (const status of allChannelsUserStatus) {
    statusByChannelId.set(status.channelId, status);
  }

  const validSectionIds = new Set(sections.map(s => s.id));
  const channelsBySectionId = new Map<string, VisibleChannel[]>();
  const unsectioned: VisibleChannel[] = [];

  for (const channel of channels) {
    const sectionId = statusByChannelId.get(channel.id)?.sectionId;
    if (sectionId && validSectionIds.has(sectionId)) {
      const existing = channelsBySectionId.get(sectionId);
      if (existing) {
        existing.push(channel);
      } else {
        channelsBySectionId.set(sectionId, [channel]);
      }
    } else {
      unsectioned.push(channel);
    }
  }

  // Within a section, order by the manual fractional sectionPosition (drag order).
  const bySectionPosition = (a: VisibleChannel, b: VisibleChannel): number => {
    const pa = statusByChannelId.get(a.id)?.sectionPosition ?? '';
    const pb = statusByChannelId.get(b.id)?.sectionPosition ?? '';
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  };

  const sectioned: SectionBucket[] = sections.map(section => ({
    section,
    channels: [...(channelsBySectionId.get(section.id) ?? [])].sort(bySectionPosition),
  }));

  return { sectioned, unsectioned };
};

/**
 * Checks if a channel is a 1:1 DM (USER scope type)
 */
export const isOneToOneDMChannel = (scopeType?: ChannelScopeType): boolean => {
  return scopeType === ChannelScopeType.DM;
};

/**
 * Checks if a channel is a Group DM
 */
export const isGroupDMChannel = (scopeType?: ChannelScopeType): boolean => {
  return scopeType === ChannelScopeType.GROUP_DM;
};

export const isDMChannel = (scopeType: ChannelScopeType): boolean => {
  return scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;
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
 * Format a channel entry for display in filter chips and typeahead labels.
 * DMs show participant names; regular channels show `#name`.
 */
export const formatChannelLabel = (ch: {
  channel: { name: string; scopeType: ChannelScopeType };
  searchableNames?: string[];
}): string => {
  if (isDMChannel(ch.channel.scopeType) && ch.searchableNames?.length) {
    return ch.searchableNames.join(', ');
  }
  return `#${ch.channel.name}`;
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
  usersById: Map<string, { name: string; displayName?: string | null }>,
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
 * Get participant IDs for querying (excluding current user)
 * Limits to 4 users for GROUP_DM (enough to show "Alice, Bob, Charlie and X others")
 */
export const getDMParticipantIdsToFetch = (
  channel: { name: string; scopeType: ChannelScopeType },
  currentUserId: string,
): string[] => {
  if (!isDMChannel(channel.scopeType)) {
    return [];
  }

  const allIds = parseDMParticipantIds(channel);
  const otherIds = allIds.filter(id => id !== currentUserId);

  // For DM: should only be 1 other user
  // For GROUP_DM: limit to 4 (we only need 3 names + count)
  return otherIds.slice(0, 4);
};

export const getDMSearchableName = (
  channel: VisibleChannel,
  userMap: Map<string, string>,
  currentUserId: string,
): string => {
  if (!isDMChannel(channel.scopeType)) return channel.name ?? '';
  const participantIds = parseDMParticipantIds(channel).filter(id => id !== currentUserId);
  const names = participantIds.map(id => userMap.get(id)).filter(Boolean) as string[];
  return names.length > 0 ? names.join(', ') : (channel.name ?? '');
};
