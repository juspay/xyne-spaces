export type DashboardNavigationDecision =
  | { action: 'allow' }
  | { action: 'navigate'; path: string }
  | { action: 'external'; url: string }
  | { action: 'block' };

export type DashboardNavigationScope = 'full' | 'focused';

const CANVAS_PATH = /^(\/[^/?#]+)?\/chat\/canvas\/([^/?#\s]+)/;

const parseHttpUrl = (rawUrl: string): URL | null => {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const normalizedOrigin = (origin: string): string | null => parseHttpUrl(origin)?.origin ?? null;

const normalizePathname = (pathname: string): string => {
  const normalized = pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return normalized || '/';
};

const isAllowedFocusedPath = (pathname: string, currentPath: string | null): boolean => {
  if (!currentPath) return normalizePathname(pathname) === '/';

  let selected: URL;
  try {
    selected = new URL(currentPath, 'https://dashboard.invalid');
  } catch {
    return false;
  }

  const expectedPathname = normalizePathname(selected.pathname);
  const actualPathname = normalizePathname(pathname);
  const canvasRootIndex = expectedPathname.indexOf('/chat/canvas');
  if (canvasRootIndex >= 0) {
    const canvasRoot = expectedPathname.slice(0, canvasRootIndex + '/chat/canvas'.length);
    return actualPathname === canvasRoot || actualPathname.startsWith(`${canvasRoot}/`);
  }

  return actualPathname === expectedPathname;
};

/**
 * Keep trusted canvas links inside the existing dashboard document. Public share links may use
 * a different trusted origin, but their canvas path is safe to normalize onto DASHBOARD_ORIGIN.
 */
export const resolveTrustedCanvasWebViewPath = (
  rawUrl: string,
  dashboardOrigin: string,
  trustedOrigins: readonly string[],
  currentPath: string | null,
): string | null => {
  const parsed = parseHttpUrl(rawUrl);
  const dashboard = normalizedOrigin(dashboardOrigin);
  if (!parsed || !dashboard) return null;

  const trusted = new Set(
    [...trustedOrigins, dashboardOrigin]
      .map(normalizedOrigin)
      .filter((origin): origin is string => origin !== null),
  );
  if (!trusted.has(parsed.origin)) return null;

  const match = parsed.pathname.match(CANVAS_PATH);
  if (!match?.[2]) return null;

  // Keep the native-selected workspace when one exists. This prevents a trusted link from
  // silently changing workspace context and avoids bouncing through a public redirect.
  const currentWorkspacePrefix = currentPath?.match(/^(\/[^/?#]+)\/chat\/canvas(?:\/|$)/)?.[1];
  const workspacePrefix = currentWorkspacePrefix ?? match[1] ?? '';
  return `${workspacePrefix}/chat/canvas/${match[2]}${parsed.search}${parsed.hash}`;
};

export const classifyDashboardWebViewNavigation = (
  rawUrl: string,
  dashboardOrigin: string,
  trustedOrigins: readonly string[],
  currentPath: string | null,
  scope: DashboardNavigationScope = 'focused',
): DashboardNavigationDecision => {
  if (rawUrl === 'about:blank') return { action: 'allow' };

  const parsed = parseHttpUrl(rawUrl);
  const dashboard = normalizedOrigin(dashboardOrigin);
  if (!parsed || !dashboard) return { action: 'block' };

  if (parsed.origin === dashboard) {
    if (scope === 'full' || isAllowedFocusedPath(parsed.pathname, currentPath)) {
      return { action: 'allow' };
    }
    return { action: 'external', url: parsed.href };
  }

  const canvasPath = resolveTrustedCanvasWebViewPath(
    rawUrl,
    dashboardOrigin,
    trustedOrigins,
    currentPath,
  );
  if (canvasPath) return { action: 'navigate', path: canvasPath };

  return { action: 'external', url: parsed.href };
};
