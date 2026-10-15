/**
 * Guards notification navigation until expo-router has landed on a real
 * protected destination.
 *
 * `isProtectedStartupReady` can flip true on the returning-session fast path
 * while `usePathname()` is still `/`. Pushing chat onto that root loses the
 * screen when `(tabs)` (DMs) mounts as the protected stack anchor.
 *
 * `rootNavigationState.key` alone is not enough on iOS cold start either.
 */
import { isTabShellRootPath } from '@/src/navigation/routes';

export function isShellReadyForNotificationNav(
  pathname: string | null | undefined,
  isProtectedStartupReady: boolean,
): boolean {
  if (!pathname || !isProtectedStartupReady) return false;

  const normalized = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === 'index') return false;

  if (normalized === '(protected)' || normalized.endsWith('/(protected)')) {
    return false;
  }

  if (isTabShellRootPath(normalized)) {
    return false;
  }

  return true;
}

export type ChatRouteParams = {
  channelId?: string | string[] | undefined;
  threadId?: string | string[] | undefined;
  conversationId?: string | string[] | undefined;
  messageId?: string | string[] | undefined;
  createdAt?: string | string[] | undefined;
  ticketId?: string | string[] | undefined;
};

const normalizeRouteValue = (value: unknown): string | undefined => {
  const candidate = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
  if (typeof candidate !== 'string') return undefined;
  const normalized = candidate.trim();
  return normalized || undefined;
};

export const getChatRouteIdentity = (
  pathname: string | null | undefined,
  routeParams: ChatRouteParams = {},
): string =>
  [
    pathname?.trim() ?? '',
    normalizeRouteValue(routeParams.channelId) ?? '',
    normalizeRouteValue(routeParams.threadId) ?? '',
    normalizeRouteValue(routeParams.conversationId) ?? '',
    normalizeRouteValue(routeParams.messageId) ?? '',
    normalizeRouteValue(routeParams.createdAt) ?? '',
    normalizeRouteValue(routeParams.ticketId) ?? '',
  ].join('|');

export function matchesChatRouteTarget(
  pathname: string | null | undefined,
  target: {
    channelId?: string;
    threadId?: string;
    conversationId?: string;
    messageId?: string;
    createdAt?: string;
    ticketId?: string;
  },
  routeParams: ChatRouteParams = {},
): boolean {
  if (!pathname) return false;

  const segments = pathname
    .trim()
    .replace(/^\/+/, '')
    .split('/')
    .map(segment => normalizeRouteValue(segment))
    .filter((segment): segment is string => segment !== undefined);
  if (target.ticketId) {
    const routeTicketId = normalizeRouteValue(routeParams.ticketId);
    const ticketIndex = segments.lastIndexOf('ticket');
    const pathTicketId = ticketIndex >= 0 ? segments[ticketIndex + 1] : undefined;
    return (routeTicketId ?? pathTicketId) === target.ticketId;
  }

  const targetChannelId = normalizeRouteValue(target.channelId);
  const targetThreadId = normalizeRouteValue(target.threadId);
  const targetConversationId = normalizeRouteValue(target.conversationId);
  const targetMessageId = normalizeRouteValue(target.messageId);
  const targetCreatedAt = normalizeRouteValue(target.createdAt);
  const routeChannelId = normalizeRouteValue(routeParams.channelId);
  const routeThreadId = normalizeRouteValue(routeParams.threadId);
  const routeConversationId = normalizeRouteValue(routeParams.conversationId);
  const routeMessageId = normalizeRouteValue(routeParams.messageId);
  const routeCreatedAt = normalizeRouteValue(routeParams.createdAt);

  if (!targetChannelId) return false;

  const isResolverRoute = segments.at(-1) === 'chat-deeplink';
  if (isResolverRoute) {
    // The resolver route has no target identity in its pathname. Its params
    // are the route identity, so an exact match is safe to consume while a
    // different message must still run the landing flow.
    if (routeChannelId !== targetChannelId) return false;
    if (targetThreadId && routeThreadId !== targetThreadId) return false;
    if (targetMessageId && routeMessageId !== targetMessageId) return false;
    if (!targetThreadId && targetConversationId && routeConversationId !== targetConversationId) {
      return false;
    }
    if (targetCreatedAt && routeCreatedAt !== targetCreatedAt) return false;
    return Boolean(targetThreadId || targetConversationId || targetMessageId || targetCreatedAt);
  }

  const chatIndex = segments.lastIndexOf('chat');
  if (chatIndex < 0 || segments[chatIndex + 1] !== targetChannelId) return false;
  const pathThreadId = segments[chatIndex + 2];
  const onMainChannel = pathThreadId === undefined;

  if (targetThreadId) {
    if (pathThreadId !== targetThreadId) return false;
    if (targetMessageId) return routeMessageId === targetMessageId;
    return true;
  }

  // A plain pathname usually names only the conversation. When the router
  // exposes exact anchor params, consume only an exact match; otherwise keep
  // the concrete target in the landing flow.
  if (targetMessageId || targetConversationId || targetCreatedAt) {
    if (!onMainChannel) return false;
    if (targetMessageId) return routeMessageId === targetMessageId;
    if (targetConversationId) {
      return routeConversationId ? routeConversationId === targetConversationId : false;
    }
    return routeCreatedAt === targetCreatedAt;
  }

  return onMainChannel;
}
