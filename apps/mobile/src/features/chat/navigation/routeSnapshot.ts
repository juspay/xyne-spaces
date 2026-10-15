let currentPathname: string | null = null;
let resolvedMainConversationChannelId: string | null = null;
export type RouteSnapshotTarget = {
  channelId?: string | undefined;
  threadId?: string | undefined;
  conversationId?: string | undefined;
  messageId?: string | undefined;
  createdAt?: string | undefined;
};
let currentRouteTarget: RouteSnapshotTarget = {};

/** The Expo Router tree is the sole writer for this notification-facing view. */
export const setRouteSnapshot = (
  pathname: string | null | undefined,
  mainConversationChannelId?: string | null,
  target: RouteSnapshotTarget = {},
): void => {
  currentPathname = pathname ?? null;
  resolvedMainConversationChannelId = mainConversationChannelId ?? null;
  currentRouteTarget = target;
};

export const getRouteSnapshotPathname = (): string | null => currentPathname;

export const getRouteSnapshotTarget = (): RouteSnapshotTarget => currentRouteTarget;

export const isCurrentMainConversation = (channelId: string): boolean => {
  if (resolvedMainConversationChannelId === channelId) return true;
  const segments = currentPathname?.replace(/^\/+/, '').split('/').filter(Boolean) ?? [];
  const chatIndex = segments.lastIndexOf('chat');
  return (
    chatIndex >= 0 && segments[chatIndex + 1] === channelId && segments[chatIndex + 2] === undefined
  );
};

export const isCurrentChatTarget = (channelId: string, threadId?: string): boolean => {
  if (!threadId) return isCurrentMainConversation(channelId);

  if (currentRouteTarget.channelId === channelId && currentRouteTarget.threadId === threadId) {
    return true;
  }

  const segments = currentPathname?.replace(/^\/+/, '').split('/').filter(Boolean) ?? [];
  const chatIndex = segments.lastIndexOf('chat');
  return (
    chatIndex >= 0 && segments[chatIndex + 1] === channelId && segments[chatIndex + 2] === threadId
  );
};
