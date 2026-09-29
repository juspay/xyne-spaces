import { useLocation } from 'react-router-dom';

export type BaseRoute =
  | '/chat/dm'
  | '/chat/dir'
  | '/chat/bookmarks'
  | '/chat/drafts-sent'
  | '/chat/activity';

const CHANNEL_ROUTE_SEGMENTS = ['dm', 'bookmarks', 'drafts-sent', 'activity'];

/**
 * Hook to detect the current route context and build a context-aware navigation URL
 */
/** The channel route base for a pathname (e.g. "/ws/chat/dm/123" -> "/chat/dm"). */
export const getBaseRoute = (pathname: string): BaseRoute => {
  const pathSegments = pathname.split('/');
  const chatIndex = pathSegments.indexOf('chat');
  const routeSegment =
    chatIndex !== -1 && chatIndex + 1 < pathSegments.length ? pathSegments[chatIndex + 1] : 'dir';

  return (
    routeSegment && CHANNEL_ROUTE_SEGMENTS.includes(routeSegment)
      ? `/chat/${routeSegment}`
      : '/chat/dir'
  ) as BaseRoute;
};

export const useRouteContext = (): {
  baseRoute: BaseRoute;
  buildChannelRoute: (channelId: string, params?: Record<string, string>) => string;
} => {
  const location = useLocation();
  const baseRoute = getBaseRoute(location.pathname);

  const buildChannelRoute = (channelId: string, params?: Record<string, string>): string => {
    const route = `${baseRoute}/${channelId}`;
    return params && Object.keys(params).length > 0
      ? `${route}?${new URLSearchParams(params).toString()}`
      : route;
  };

  return {
    baseRoute,
    buildChannelRoute,
  };
};
