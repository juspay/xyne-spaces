/**
 * Maps an Expo route segment to a dashboard pathname.
 * Add entries here when introducing new native screens that should render via WebView overlay.
 */
export const DASHBOARD_WEBVIEW_ROUTES = {
  canvas: '/chat/canvas',
  rca: '/rca',
  call: '/call',
  'channel-canvas': '/chat/dir',
} as const;

export function prefixPathForDashboardWebview(
  path: string,
  workspaceId: string | null | undefined,
): string {
  if (!workspaceId) {
    return path;
  }
  if (path === `/${workspaceId}` || path.startsWith(`/${workspaceId}/`)) {
    return path;
  }
  if (
    path === '/call' ||
    path.startsWith('/call/') ||
    path === '/calls' ||
    path.startsWith('/calls/') ||
    path === '/redirected' ||
    path.startsWith('/redirected/') ||
    path === '/auth' ||
    path.startsWith('/auth/')
  ) {
    return path;
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `/${workspaceId}${normalized}`;
}

type SearchParamValue = string | string[] | undefined;
export type DashboardSearchParamsInput = Record<string, SearchParamValue>;

export type DashboardWebviewTarget = {
  visible: boolean;
  path: string | null;
  segment: string | null;
};

function isDashboardWebviewSegment(seg: string): seg is keyof typeof DASHBOARD_WEBVIEW_ROUTES {
  return seg in DASHBOARD_WEBVIEW_ROUTES;
}

function appendQueryParams(
  path: string,
  searchParams?: DashboardSearchParamsInput,
  keysToExclude: string[] = [],
): string {
  if (!searchParams) {
    return path;
  }

  const query = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(searchParams)) {
    if (keysToExclude.includes(key)) {
      continue;
    }

    if (typeof rawValue === 'string') {
      if (rawValue.length > 0) {
        query.append(key, rawValue);
      }
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        if (typeof value === 'string' && value.length > 0) {
          query.append(key, value);
        }
      }
    }
  }

  const queryString = query.toString();
  if (!queryString) {
    return path;
  }

  return `${path}?${queryString}`;
}

/**
 * Picks the active dashboard WebView route from the current segment stack.
 * Walks from leaf inward so nested layouts resolve to the focused screen.
 * Supports dynamic routes like call/[callId].
 */
export function resolveDashboardWebViewTarget(
  segments: string[],
  searchParams?: DashboardSearchParamsInput,
  workspaceId?: string | null,
): DashboardWebviewTarget {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    if (!seg || !isDashboardWebviewSegment(seg)) {
      continue;
    }

    let path: string = DASHBOARD_WEBVIEW_ROUTES[seg];
    let routeParamKey: string | null = null;

    // Handle special case for channel-canvas: /chat/dir/${channelId}?tab=canvas
    if (seg === 'channel-canvas') {
      const channelId = searchParams?.['channelId'];
      if (typeof channelId === 'string' && channelId.length > 0) {
        path = `${path}/${channelId}`;
      }
      // Add tab=canvas to query params
      const query = new URLSearchParams();
      query.append('tab', 'canvas');
      // Append other query params excluding channelId
      for (const [key, rawValue] of Object.entries(searchParams ?? {})) {
        if (key === 'channelId') continue;
        if (typeof rawValue === 'string' && rawValue.length > 0) {
          query.append(key, rawValue);
        } else if (Array.isArray(rawValue)) {
          for (const value of rawValue) {
            if (typeof value === 'string' && value.length > 0) {
              query.append(key, value);
            }
          }
        }
      }
      const queryString = query.toString();
      const finalPath = prefixPathForDashboardWebview(
        queryString ? `${path}?${queryString}` : path,
        workspaceId,
      );
      return {
        visible: true,
        path: finalPath,
        segment: seg,
      };
    }

    if (seg === 'canvas') {
      const canvasId = searchParams?.['canvasId'];
      if (typeof canvasId === 'string' && canvasId.length > 0) {
        path = `${path}/${canvasId}`;
      }
    }

    // Handle dynamic child route placeholder, e.g. call/[callId]
    if (i + 1 < segments.length) {
      const nextSeg = segments[i + 1];
      if (typeof nextSeg === 'string') {
        if (nextSeg.startsWith('[') && nextSeg.endsWith(']')) {
          const paramName = nextSeg.slice(1, -1);
          routeParamKey = paramName;
          const paramValue = searchParams?.[paramName];
          if (typeof paramValue === 'string' && paramValue.length > 0) {
            path = `${path}/${paramValue}`;
          }
        } else if (nextSeg.length > 0) {
          path = `${path}/${nextSeg}`;
        }
      }
    }

    const excludedParams = routeParamKey ? [routeParamKey] : [];
    if (seg === 'canvas') {
      excludedParams.push('canvasId');
    }
    const finalPath = prefixPathForDashboardWebview(
      appendQueryParams(path, searchParams, excludedParams),
      workspaceId,
    );

    return {
      visible: true,
      path: finalPath,
      segment: seg,
    };
  }

  return {
    visible: false,
    path: null,
    segment: null,
  };
}
