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
export const useRouteContext = (): {
  baseRoute: BaseRoute;
  buildChannelRoute: (channelId: string, params?: Record<string, string>) => string;
} => {
  const location = useLocation();

  // Extract route type from pathname (e.g., "/chat/dm/123" -> "dm")
  const pathSegments = location.pathname.split('/');
  const chatIndex = pathSegments.indexOf('chat');
  const routeSegment =
    chatIndex !== -1 && chatIndex + 1 < pathSegments.length ? pathSegments[chatIndex + 1] : 'dir';

  const baseRoute = (
    routeSegment && CHANNEL_ROUTE_SEGMENTS.includes(routeSegment)
      ? `/chat/${routeSegment}`
      : '/chat/dir'
  ) as BaseRoute;

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
