import {
  ChannelScopeType,
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
  for (const channel of channelData) {
    // EMAIL channels live in Xyne Desk, not in the chat directory.
    // TODO: filter this out at the source by excluding EMAIL-type channels in the
    // `visibleChannels` query itself, so the client never receives them here.
    if (isDeskChannelType(channel.type)) {
      continue;
    }

    const currentUserParticipation = allChannelsUserStatus.find(p => p.channelId === channel.id);

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
