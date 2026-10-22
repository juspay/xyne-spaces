import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

/**
 * Pure target-selection rules for the mobile forward sheet. Mirrors the web
 * ForwardMessageModal (apps/dashboard/src/components/Chat/ForwardMessageModal):
 *
 * - Targets are a single channel, a single group DM (plus extra users), or one or
 *   more users.
 * - A group DM is forwarded by re-resolving its exact member set through
 *   `POST /users/me/dms`, so the message lands in that group DM and adding users
 *   moves it to the group DM with the wider member set.
 * - Recipients are capped at {@link MAX_FORWARD_RECIPIENTS} (the backend rejects
 *   more than 9 others).
 */

export const MAX_FORWARD_RECIPIENTS = 9;

const DEFAULT_SUGGESTIONS_PER_KIND = 5;
const SEARCH_USER_LIMIT = 20;
const SEARCH_GROUP_LIMIT = 5;
const SEARCH_CHANNEL_LIMIT = 5;
const GROUP_LABEL_MAX_NAMES = 3;

export type ForwardTargetType = 'channel' | 'user' | 'group_dm';

export type ForwardTarget = {
  type: ForwardTargetType;
  id: string;
  name: string;
  /** Other members of the group DM (current user excluded). Only for `group_dm`. */
  memberIds?: string[];
};

export type SelectionMode = 'none' | 'channel' | 'users' | 'group_dm';

export type ForwardSearchListItem = {
  id: string;
  type: ForwardTargetType;
  name: string;
  description?: string;
  isPrivate?: boolean;
  picture?: string;
  /** Other members of the group DM (current user excluded). Only for `group_dm`. */
  memberIds?: string[];
};

export type ForwardChannel = {
  id: string;
  name: string;
  scopeType: ChannelScopeType;
  visibility?: ChannelVisibility | string | null | undefined;
  description?: string | null | undefined;
  isArchived?: boolean | null | undefined;
  channelStats?: { lastActivityAt?: number | null | undefined } | null | undefined;
};

export type ForwardUser = {
  id: string;
  name?: string | null | undefined;
  displayName?: string | null | undefined;
  email?: string | null | undefined;
  picture?: string | null | undefined;
};

const parseParticipantIds = (channel: ForwardChannel): string[] =>
  channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM
    ? channel.name.split(',').filter(Boolean)
    : [];

const lastActivity = (channel: ForwardChannel): number => channel.channelStats?.lastActivityAt ?? 0;

const byRecentActivity = (a: ForwardChannel, b: ForwardChannel): number =>
  lastActivity(b) - lastActivity(a);

export const getForwardUserName = (user: ForwardUser): string =>
  user.displayName || user.name || user.email || 'Unknown';

/** Channels (not DMs) and group DMs that can receive a forward. */
export const isForwardableChannel = (channel: ForwardChannel): boolean =>
  channel.scopeType === ChannelScopeType.DEFAULT && channel.isArchived !== true;

export const isForwardableGroupDm = (channel: ForwardChannel): boolean =>
  channel.scopeType === ChannelScopeType.GROUP_DM && channel.isArchived !== true;

export const getGroupDmMemberIds = (channel: ForwardChannel, currentUserId: string): string[] =>
  parseParticipantIds(channel).filter(id => id !== currentUserId);

const getGroupDmMembers = (
  channel: ForwardChannel,
  currentUserId: string,
  usersById: ReadonlyMap<string, ForwardUser>,
): ForwardUser[] =>
  getGroupDmMemberIds(channel, currentUserId)
    .map(id => usersById.get(id))
    .filter((user): user is ForwardUser => user !== undefined);

/** Full member list, e.g. "Asha, Ravi, Meera, Kiran". */
export const getGroupDmLabel = (members: readonly ForwardUser[]): string =>
  members.map(getForwardUserName).join(', ');

/** Compact chip label, e.g. "Asha, Ravi, Meera +2 more". */
export const getGroupDmChipLabel = (members: readonly ForwardUser[]): string => {
  if (members.length <= GROUP_LABEL_MAX_NAMES) return getGroupDmLabel(members);
  const shown = getGroupDmLabel(members.slice(0, GROUP_LABEL_MAX_NAMES));
  return `${shown} +${members.length - GROUP_LABEL_MAX_NAMES} more`;
};

export const getSelectionMode = (selectedTargets: readonly ForwardTarget[]): SelectionMode => {
  const first = selectedTargets[0];
  if (!first) return 'none';
  if (first.type === 'channel') return 'channel';
  if (first.type === 'group_dm') return 'group_dm';
  return 'users';
};

/** Recipients counted against the 9-person cap: group DM members plus selected users. */
export const getTotalRecipientCount = (selectedTargets: readonly ForwardTarget[]): number =>
  getForwardRecipientIds(selectedTargets).length;

export const canAddMoreTargets = (selectedTargets: readonly ForwardTarget[]): boolean => {
  const mode = getSelectionMode(selectedTargets);
  if (mode === 'channel') return false;
  return getTotalRecipientCount(selectedTargets) < MAX_FORWARD_RECIPIENTS;
};

/**
 * Participant ids sent to `POST /users/me/dms`. For a group DM this is its
 * members plus any extra users, which the backend resolves to the existing group
 * DM with exactly that member set (or creates it).
 */
export const getForwardRecipientIds = (selectedTargets: readonly ForwardTarget[]): string[] => {
  const ids: string[] = [];
  for (const target of selectedTargets) {
    if (target.type === 'group_dm') ids.push(...(target.memberIds ?? []));
    else if (target.type === 'user') ids.push(target.id);
  }
  return [...new Set(ids)];
};

/** Applies a picked item to the current selection, following the web rules. */
export const applyForwardSelection = (
  selectedTargets: readonly ForwardTarget[],
  item: ForwardSearchListItem,
): ForwardTarget[] => {
  if (item.type === 'channel') {
    return [{ type: 'channel', id: item.id, name: item.name }];
  }
  if (item.type === 'group_dm') {
    return [{ type: 'group_dm', id: item.id, name: item.name, memberIds: item.memberIds ?? [] }];
  }
  const mode = getSelectionMode(selectedTargets);
  if (mode === 'channel') {
    return [{ type: 'user', id: item.id, name: item.name }];
  }
  const alreadySelected =
    selectedTargets.some(t => t.type === 'user' && t.id === item.id) ||
    getForwardRecipientIds(selectedTargets).includes(item.id);
  if (alreadySelected || !canAddMoreTargets(selectedTargets)) {
    return [...selectedTargets];
  }
  return [...selectedTargets, { type: 'user', id: item.id, name: item.name }];
};

type BuildForwardTargetItemsArgs = {
  channels: readonly ForwardChannel[];
  users: readonly ForwardUser[];
  currentUserId: string;
  query: string;
  selectedTargets: readonly ForwardTarget[];
};

/**
 * Suggestions for the forward sheet, in the same order as web: people, then
 * group DMs, then channels. With an empty query and nothing selected it shows
 * recent DMs, recent group DMs and recent channels.
 */
export const buildForwardTargetItems = ({
  channels,
  users,
  currentUserId,
  query,
  selectedTargets,
}: BuildForwardTargetItemsArgs): ForwardSearchListItem[] => {
  const mode = getSelectionMode(selectedTargets);
  if (mode !== 'none' && !canAddMoreTargets(selectedTargets)) return [];

  const usersById = new Map(users.map(user => [user.id, user]));
  const trimmed = query.trim().toLowerCase();
  const excludedUserIds = new Set(getForwardRecipientIds(selectedTargets));

  const toUserItem = (user: ForwardUser): ForwardSearchListItem => {
    const isSelf = user.id === currentUserId;
    const base = getForwardUserName(user);
    const item: ForwardSearchListItem = {
      id: user.id,
      type: 'user',
      name: isSelf ? `${base} (You)` : base,
    };
    if (user.email) item.description = user.email;
    if (user.picture) item.picture = user.picture;
    return item;
  };

  const toGroupItem = (channel: ForwardChannel): ForwardSearchListItem | null => {
    const members = getGroupDmMembers(channel, currentUserId, usersById);
    if (members.length === 0) return null;
    return {
      id: channel.id,
      type: 'group_dm',
      name: getGroupDmChipLabel(members),
      description: getGroupDmLabel(members),
      memberIds: getGroupDmMemberIds(channel, currentUserId),
    };
  };

  const toChannelItem = (channel: ForwardChannel): ForwardSearchListItem => {
    const item: ForwardSearchListItem = {
      id: channel.id,
      type: 'channel',
      name: channel.name,
      isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
    };
    if (channel.description) item.description = channel.description;
    return item;
  };

  // Self is a valid target only as a solo "notes to self" pick (same as web).
  const isUserEligible = (user: ForwardUser): boolean =>
    !excludedUserIds.has(user.id) && !(user.id === currentUserId && mode !== 'none');

  const groupDms = channels.filter(isForwardableGroupDm);
  const forwardableChannels = channels.filter(isForwardableChannel);

  if (!trimmed) {
    if (mode !== 'none') return [];

    const defaults: ForwardSearchListItem[] = [];
    const recentDmUserIds = channels
      .filter(channel => channel.scopeType === ChannelScopeType.DM && channel.isArchived !== true)
      .sort(byRecentActivity)
      .map(channel => {
        const ids = parseParticipantIds(channel);
        if (ids.length === 1 && ids[0] === currentUserId) return currentUserId;
        return ids.find(id => id !== currentUserId);
      })
      .filter((id): id is string => !!id);
    const seenUsers = new Set<string>();
    for (const id of recentDmUserIds) {
      if (seenUsers.size >= DEFAULT_SUGGESTIONS_PER_KIND) break;
      const user = usersById.get(id);
      if (!user || seenUsers.has(id)) continue;
      seenUsers.add(id);
      defaults.push(toUserItem(user));
    }

    [...groupDms]
      .sort(byRecentActivity)
      .map(toGroupItem)
      .filter((item): item is ForwardSearchListItem => item !== null)
      .slice(0, DEFAULT_SUGGESTIONS_PER_KIND)
      .forEach(item => defaults.push(item));

    [...forwardableChannels]
      .sort(byRecentActivity)
      .slice(0, DEFAULT_SUGGESTIONS_PER_KIND)
      .forEach(channel => defaults.push(toChannelItem(channel)));

    if (defaults.length > 0) return defaults;

    // No DM/channel history yet: fall back to people so the list is never empty.
    return users
      .filter(user => user.id !== currentUserId)
      .map(toUserItem)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, SEARCH_USER_LIMIT);
  }

  const matches = (...values: (string | null | undefined)[]): boolean =>
    values.some(value => value?.toLowerCase().includes(trimmed) ?? false);

  const suggestedUsers = users
    .filter(isUserEligible)
    .filter(user => matches(user.displayName, user.name, user.email))
    .map(toUserItem)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, SEARCH_USER_LIMIT);

  if (mode === 'users' || mode === 'group_dm') return suggestedUsers;

  const suggestedChannels = forwardableChannels
    .filter(channel => matches(channel.name, channel.description))
    .sort(byRecentActivity)
    .slice(0, SEARCH_CHANNEL_LIMIT)
    .map(toChannelItem);

  if (mode === 'channel') return suggestedChannels;

  const suggestedGroups = groupDms
    .filter(channel =>
      getGroupDmMembers(channel, currentUserId, usersById).some(user =>
        matches(user.displayName, user.name, user.email),
      ),
    )
    .sort(byRecentActivity)
    .map(toGroupItem)
    .filter((item): item is ForwardSearchListItem => item !== null)
    .slice(0, SEARCH_GROUP_LIMIT);

  return [...suggestedUsers, ...suggestedGroups, ...suggestedChannels];
};
