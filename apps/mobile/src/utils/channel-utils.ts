import { Channel, ChannelScopeType } from '@xyne/shared';
import { User } from '@/src/machines/appStateMachine';
import { isStatusExpired } from '@/src/utils/statusUtils';

type ChannelWithParticipants = {
  id: string;
  name: string;
  scopeType: ChannelScopeType;
};

type ChannelNameUser = { id: string; name?: string };

const channelNameUsersMapCache = new WeakMap<
  ReadonlyArray<ChannelNameUser>,
  Map<string, ChannelNameUser>
>();

/** One id→user map per directory array, shared by every header and name lookup. */
export function getChannelNameUsersMap(
  users: ReadonlyArray<ChannelNameUser>,
): Map<string, ChannelNameUser> {
  const cached = channelNameUsersMapCache.get(users);
  if (cached) {
    return cached;
  }

  const map = new Map(users.map(user => [user.id, user]));
  channelNameUsersMapCache.set(users, map);
  return map;
}

export function isDMChannel(scopeType: ChannelScopeType): boolean {
  return scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;
}

export function isGroupDMChannel(scopeType: ChannelScopeType): boolean {
  return scopeType === ChannelScopeType.GROUP_DM;
}

/** Avatars beside incoming bubbles — channels and group DMs only, not 1:1 DMs. */
export function shouldShowMessageAvatars(scopeType: ChannelScopeType): boolean {
  return scopeType === ChannelScopeType.DEFAULT || scopeType === ChannelScopeType.GROUP_DM;
}

/** Channel.name is "userId1,userId2,..." sorted */
export function parseDMParticipantIds(channel: {
  name: string;
  scopeType: ChannelScopeType;
}): string[] {
  if (!isDMChannel(channel.scopeType)) return [];
  return channel.name.split(',').filter(Boolean);
}

export function getOtherParticipantIds(
  channel: { name: string; scopeType: ChannelScopeType },
  currentUserId: string,
): string[] {
  return parseDMParticipantIds(channel).filter(id => id !== currentUserId);
}

export function isSelfDmChannel(
  channel: { name: string; scopeType: ChannelScopeType },
  currentUserId: string,
): boolean {
  if (channel.scopeType !== ChannelScopeType.DM) return false;
  const allIds = parseDMParticipantIds(channel);
  return allIds.length === 1 && allIds[0] === currentUserId;
}

/** User ids to pass to Avatar — includes self for saved/self DMs. */
export function getDmAvatarUserIds(
  channel: { name: string; scopeType: ChannelScopeType },
  currentUserId: string,
): string[] {
  if (isSelfDmChannel(channel, currentUserId)) {
    return [currentUserId];
  }
  return getOtherParticipantIds(channel, currentUserId);
}

/** Existing 1:1 DM between the current user and targetUserId, if any. */
export function findOneToOneDmChannel(
  channels: readonly ChannelWithParticipants[],
  currentUserId: string,
  targetUserId: string,
): ChannelWithParticipants | undefined {
  if (currentUserId === targetUserId) {
    return channels.find(channel => isSelfDmChannel(channel, currentUserId));
  }

  return channels.find(channel => {
    if (channel.scopeType !== ChannelScopeType.DM) return false;
    const participantIds = parseDMParticipantIds(channel);
    if (participantIds.length !== 2) return false;
    const set = new Set(participantIds);
    return set.has(currentUserId) && set.has(targetUserId);
  });
}

export type ActiveUserStatus = {
  emoji: string;
  content?: string | null | undefined;
};

export function getActiveUserStatus(user: {
  statusEmoji?: string | null;
  statusContent?: string | null;
  statusExpiryAt?: number | null;
}): ActiveUserStatus | undefined {
  const { statusEmoji, statusContent, statusExpiryAt } = user;

  if (!statusEmoji) return undefined;
  if (statusExpiryAt && isStatusExpired(statusExpiryAt)) return undefined;

  return {
    emoji: statusEmoji,
    content: statusContent,
  };
}

export function getUserDisplayName(user: User | undefined | null): string {
  if (!user) return 'Unknown';
  return user.displayName || user.name || user.email || 'Unknown';
}

export function getChannelDisplayName(
  channel: Channel,
  currentUserId: string,
  usersById: ReadonlyMap<string, User>,
): string {
  if (!isDMChannel(channel.scopeType)) {
    return channel.name;
  }

  const otherIds = getOtherParticipantIds(channel, currentUserId);

  if (channel.scopeType === ChannelScopeType.DM) {
    const allIds = parseDMParticipantIds(channel);
    const isSelfDm = allIds.length === 1 && allIds[0] === currentUserId;

    if (isSelfDm) {
      const me = usersById.get(currentUserId);
      return me ? `${getUserDisplayName(me)} (you)` : 'You';
    }

    const user = otherIds[0] ? usersById.get(otherIds[0]) : undefined;
    return user ? getUserDisplayName(user) : 'Unknown User';
  }

  // GROUP_DM
  const names = otherIds
    .slice(0, 4)
    .map(id => usersById.get(id))
    .filter(Boolean)
    .map(u => getUserDisplayName(u!));

  if (names.length === 0) return 'Group Chat';
  if (otherIds.length <= 3) return names.join(', ');

  const remaining = otherIds.length - 3;
  return `${names.slice(0, 3).join(', ')} and ${remaining} other${remaining > 1 ? 's' : ''}`;
}

/**
 * Why the conversation header can or cannot show a real title.
 * Matches `useChannelDisplayName` (name-only lookup, not email fallback).
 * `pending` means the startup lists have not been published yet — show a
 * skeleton, not the word "Unknown".
 */
export type ConversationHeaderTitleStatus =
  'pending' | 'resolved' | 'unknown' | 'unknown_user' | 'group_fallback';

export function classifyConversationHeaderTitle(input: {
  channel: { name: string; scopeType: ChannelScopeType } | null | undefined;
  currentUserId: string;
  usersById: ReadonlyMap<string, { name?: string }>;
  visibleChannelsReady: boolean;
  usersReady: boolean;
  /** Notification open: this channel is not in the list yet. Keep the skeleton. */
  holdAbsentChannel?: boolean;
}): ConversationHeaderTitleStatus {
  const { channel, currentUserId, usersById, visibleChannelsReady, usersReady } = input;

  if (!channel) {
    // A notification open can see a stale visible-channel cache before the
    // live list arrives. Hold Unknown until that journey ends.
    if (!visibleChannelsReady || input.holdAbsentChannel) {
      return 'pending';
    }
    return 'unknown';
  }

  if (channel.scopeType === ChannelScopeType.DEFAULT) {
    return 'resolved';
  }

  if (channel.scopeType === ChannelScopeType.DM) {
    const participantIds = parseDMParticipantIds(channel);
    const otherUserId = participantIds.find(id => id !== currentUserId);

    if (!otherUserId && participantIds.length === 1 && participantIds[0] === currentUserId) {
      return 'resolved';
    }

    if (!otherUserId) {
      return usersReady ? 'unknown_user' : 'pending';
    }

    return usersById.get(otherUserId)?.name ? 'resolved' : usersReady ? 'unknown_user' : 'pending';
  }

  if (channel.scopeType === ChannelScopeType.GROUP_DM) {
    const otherIds = getOtherParticipantIds(channel, currentUserId);
    const hasName = otherIds.some(id => Boolean(usersById.get(id)?.name));
    if (hasName) return 'resolved';
    return usersReady ? 'group_fallback' : 'pending';
  }

  return 'resolved';
}
