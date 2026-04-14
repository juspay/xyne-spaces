interface UserLike {
  id: string;
  name: string;
  email: string;
  status: string | null;
}

interface ChannelLike {
  id: string;
  name: string;
  scopeType: string | null;
  visibility: string | null;
  lastActivityAt?: number | null;
}

export const shallowEqualUsers = <T extends UserLike>(
  a: T[],
  b: T[],
): boolean => {
  if (a.length !== b.length) return false;
  return a.every((user, index) => {
    const otherUser = b[index];
    return (
      otherUser &&
      user.id === otherUser.id &&
      user.name === otherUser.name &&
      user.email === otherUser.email &&
      user.status === otherUser.status
    );
  });
};

export const shallowEqualChannels = <T extends ChannelLike>(
  a: T[],
  b: T[],
): boolean => {
  if (a.length !== b.length) return false;
  return a.every((channel, index) => {
    const otherChannel = b[index];
    return (
      otherChannel &&
      channel.id === otherChannel.id &&
      channel.name === otherChannel.name &&
      channel.scopeType === otherChannel.scopeType &&
      channel.visibility === otherChannel.visibility &&
      channel.lastActivityAt === otherChannel.lastActivityAt
    );
  });
};

export const formatChannelTimestamp = (ts: number): string => {
  if (!ts) return '';
  const now = new Date();
  const date = new Date(ts);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
