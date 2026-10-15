type UserLike = {
  id: string;
  displayName?: string | null;
  name?: string | null;
  email?: string | null;
};

type ChannelLike = { id: string; name: string };

type GroupLike = {
  id: string;
  name?: string | null;
  alias?: string | null;
};

const userNameMapCache = new WeakMap<object, Map<string, string>>();
const channelNameMapCache = new WeakMap<object, Map<string, string>>();
const groupNameMapCache = new WeakMap<object, Map<string, string>>();

const getDisplayName = (user: UserLike): string =>
  user.displayName || user.name || user.email || 'Unknown';

export const getCachedUserNames = (users: readonly UserLike[]): Map<string, string> => {
  const cached = userNameMapCache.get(users);
  if (cached) return cached;
  const map = new Map(users.map(user => [user.id, getDisplayName(user)]));
  userNameMapCache.set(users, map);
  return map;
};

export const getCachedChannelNames = (channels: readonly ChannelLike[]): Map<string, string> => {
  const cached = channelNameMapCache.get(channels);
  if (cached) return cached;
  const map = new Map(channels.map(channel => [channel.id, channel.name]));
  channelNameMapCache.set(channels, map);
  return map;
};

export const getCachedGroupNames = (groups: readonly GroupLike[]): Map<string, string> => {
  const cached = groupNameMapCache.get(groups);
  if (cached) return cached;
  const map = new Map(groups.map(group => [group.id, group.alias || group.name || group.id]));
  groupNameMapCache.set(groups, map);
  return map;
};
