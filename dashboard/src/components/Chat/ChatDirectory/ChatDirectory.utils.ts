import { ChannelScopeType, Channel, ChannelUserStatus } from '@xyne/shared';

// Optimized function to group channels by scope type (single pass)
export const groupChannelsByScope = (
  channelData: Channel[],
  allChannelsUserStatus: ChannelUserStatus[],
): {
  starred: Channel[];
  channels: Channel[];
  directMessages: Channel[];
} => {
  const starred: Channel[] = [];
  const channels: Channel[] = [];
  const directMessages: Channel[] = [];

  for (const channel of channelData) {
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
