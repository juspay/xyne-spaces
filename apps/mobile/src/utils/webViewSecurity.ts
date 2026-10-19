const parseUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};

const hasCredentials = (url: URL): boolean => Boolean(url.username || url.password);

const normalizePathname = (pathname: string): string => {
  const normalized = pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return normalized || '/';
};

/**
 * A focused canvas may move between canvases of the same workspace (canvas links stay inside the
 * WebView); every other focused route is locked to its exact path. Returns the
 * `/<workspace>/chat/canvas` root, or null when the selected path is not a canvas.
 */
const canvasFamilyRoot = (pathname: string): string | null => {
  const index = pathname.indexOf('/chat/canvas');
  return index >= 0 ? pathname.slice(0, index + '/chat/canvas'.length) : null;
};

const hasExactSelectedQuery = (actual: URLSearchParams, expected: URLSearchParams): boolean => {
  const selectedKeys = new Set(expected.keys());
  for (const key of selectedKeys) {
    const expectedValues = expected.getAll(key);
    const actualValues = actual.getAll(key);
    if (
      expectedValues.length !== actualValues.length ||
      expectedValues.some((value, index) => actualValues[index] !== value)
    ) {
      return false;
    }
  }
  return true;
};

export type TrustedWebViewNavigationState = {
  url: string | null;
  generation: number;
};

/**
 * The dashboard WebView is a privileged bridge. Compare parsed origins rather
 * than string prefixes so lookalike hosts, alternate ports, and malformed URLs
 * cannot reach the native bridge.
 */
export const isTrustedWebViewOrigin = (rawUrl: string, expectedOrigin: string): boolean => {
  const url = parseUrl(rawUrl);
  const expected = parseUrl(expectedOrigin);
  if (!url || !expected || hasCredentials(url) || hasCredentials(expected)) {
    return false;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return false;
  }

  return url.origin === expected.origin;
};

/**
 * Limit a privileged WebView to the native-selected dashboard resource.
 * Query parameters already selected by native must match exactly (including
 * duplicate values); unselected parameters and fragments are allowed.
 */
export const isAllowedDashboardRoute = (
  rawUrl: string,
  expectedOrigin: string,
  expectedPath: string | null,
): boolean => {
  if (!isTrustedWebViewOrigin(rawUrl, expectedOrigin)) return false;

  const url = parseUrl(rawUrl);
  const expectedOriginUrl = parseUrl(expectedOrigin);
  if (!url || !expectedOriginUrl) return false;
  if (!expectedPath) return normalizePathname(url.pathname) === '/';

  let expected: URL;
  try {
    expected = parseUrl(expectedPath) ?? new URL(expectedPath, expectedOriginUrl.origin);
  } catch {
    return false;
  }
  if (expected.origin !== expectedOriginUrl.origin || hasCredentials(expected)) return false;

  const expectedPathname = normalizePathname(expected.pathname);
  const actualPathname = normalizePathname(url.pathname);
  if (actualPathname === expectedPathname) {
    return hasExactSelectedQuery(url.searchParams, expected.searchParams);
  }
  const canvasRoot = canvasFamilyRoot(expectedPathname);
  if (canvasRoot) {
    return actualPathname === canvasRoot || actualPathname.startsWith(`${canvasRoot}/`);
  }
  return false;
};

/**
 * Install a best-effort SPA route guard for focused views. Native navigation
 * callbacks remain the security boundary; this script keeps client-side
 * pushState/replaceState links from visibly escaping to dashboard chrome.
 */
export const createFocusedRouteLockScript = (expectedPath: string | null): string => {
  if (!expectedPath) return 'true;';

  return `
(function () {
  try {
    var target = ${JSON.stringify(expectedPath)};
    var targetUrl = new URL(target, window.location.origin);
    var normalize = function (pathname) {
      var value = pathname.replace(/\\/{2,}/g, '/').replace(/\\/$/, '');
      return value || '/';
    };
    var targetPathname = normalize(targetUrl.pathname);
    var canvasIndex = targetPathname.indexOf('/chat/canvas');
    var canvasRoot =
      canvasIndex >= 0 ? targetPathname.slice(0, canvasIndex + '/chat/canvas'.length) : null;
    var isFocusedRoute = function (value) {
      var current = new URL(value || window.location.href, window.location.origin);
      var currentPathname = normalize(current.pathname);
      if (currentPathname !== targetPathname) {
        return Boolean(
          canvasRoot &&
            (currentPathname === canvasRoot || currentPathname.indexOf(canvasRoot + '/') === 0),
        );
      }
      var selectedKeys = new Set(targetUrl.searchParams.keys());
      for (var key of selectedKeys) {
        var expectedValues = targetUrl.searchParams.getAll(key);
        var actualValues = current.searchParams.getAll(key);
        if (expectedValues.length !== actualValues.length) return false;
        for (var index = 0; index < expectedValues.length; index += 1) {
          if (actualValues[index] !== expectedValues[index]) return false;
        }
      }
      return true;
    };
    var originalPushState = history.pushState;
    var originalReplaceState = history.replaceState;
    var enforce = function () {
      if (isFocusedRoute(window.location.href)) return;
      originalReplaceState.call(history, {}, '', target);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };
    history.pushState = function (state, title, url) {
      originalPushState.apply(history, arguments);
      enforce();
    };
    history.replaceState = function (state, title, url) {
      originalReplaceState.apply(history, arguments);
      enforce();
    };
    window.addEventListener('popstate', enforce);
  } catch (_) {}
})();
true;
`;
};

/**
 * WebView reports both load-start and load-finish for one URL. Keep the same
 * generation for those duplicate callbacks, while invalidating async work on
 * an actual URL transition or an untrusted navigation.
 */
export const updateTrustedWebViewNavigation = (
  current: TrustedWebViewNavigationState,
  rawUrl: string,
  expectedOrigin: string,
  expectedPath?: string | null,
): TrustedWebViewNavigationState => {
  const isTrusted =
    isTrustedWebViewOrigin(rawUrl, expectedOrigin) &&
    (expectedPath === undefined || isAllowedDashboardRoute(rawUrl, expectedOrigin, expectedPath));
  return {
    url: isTrusted ? rawUrl : null,
    generation: current.url === rawUrl ? current.generation : current.generation + 1,
  };
};

/**
 * A dashboard may embed non-privileged content such as the recording canvas.
 * Permit those subframes to render, but keep every top-level navigation on the
 * native-selected focused route. Bridge delivery still requires the sender URL
 * check.
 */
export const isAllowedDashboardNavigation = (
  rawUrl: string,
  expectedOrigin: string,
  isTopFrame = true,
  expectedPath?: string | null,
): boolean =>
  !isTopFrame ||
  (expectedPath === undefined
    ? isTrustedWebViewOrigin(rawUrl, expectedOrigin)
    : isAllowedDashboardRoute(rawUrl, expectedOrigin, expectedPath));

/**
 * A local PDF may update its fragment while paging or zooming, but it must not
 * navigate to another local file or an external URL. `about:blank` is allowed
 * for the viewer's internal blank-document transitions.
 */
export const isAllowedPdfNavigation = (rawUrl: string, initialPdfUri: string): boolean => {
  if (rawUrl === 'about:blank') return true;

  const url = parseUrl(rawUrl);
  const initialPdf = parseUrl(initialPdfUri);
  if (!url || !initialPdf || url.protocol !== 'file:' || initialPdf.protocol !== 'file:') {
    return false;
  }

  if (hasCredentials(url) || hasCredentials(initialPdf) || url.host !== initialPdf.host) {
    return false;
  }

  return url.pathname === initialPdf.pathname && url.search === initialPdf.search;
};

const isRejectedExternalUrlInput = (rawUrl: string): boolean =>
  typeof rawUrl !== 'string' ||
  rawUrl.length === 0 ||
  rawUrl !== rawUrl.trim() ||
  // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted URLs.
  /[\u0000-\u001F\u007F]/.test(rawUrl) ||
  /%(?![0-9A-Fa-f]{2})/.test(rawUrl);

const parseSafeExternalUrl = (rawUrl: string): URL | null => {
  if (isRejectedExternalUrlInput(rawUrl)) return null;
  const url = parseUrl(rawUrl);
  if (!url || hasCredentials(url)) return null;
  return url;
};

const isSafeHttpUrl = (url: URL): boolean =>
  (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== 'null';

/**
 * Chat and activity content historically opens mail and phone handlers. Keep
 * those two registered OS schemes, but reject `mailto://` host forms and nested
 * schemes so this is not a generic custom-scheme trampoline.
 */
const isSafeMailtoUrl = (url: URL): boolean => {
  if (url.protocol !== 'mailto:' || url.host) return false;
  if (url.pathname.includes('/') || url.pathname.includes('://')) return false;
  return url.pathname.includes('@') || url.search.length > 0;
};

const isSafeTelUrl = (url: URL): boolean => {
  if (url.protocol !== 'tel:' || url.host || url.search) return false;
  let phone: string;
  try {
    phone = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  return /^\+?[0-9().\-;\s]+$/.test(phone) && /\d/.test(phone);
};

/**
 * Dashboard WebView popups may only hand HTTP(S) links to the OS. Contact
 * schemes stay out of this path so a privileged page cannot launch the dialer
 * or a mail draft without an explicit in-app control.
 */
export const isSafeExternalWebViewUrl = (rawUrl: string): boolean => {
  const url = parseSafeExternalUrl(rawUrl);
  return Boolean(url && isSafeHttpUrl(url));
};

/**
 * Chat, mentions, previews and channel-link lists may open HTTP(S), mailto,
 * and tel. Every other scheme is rejected so server-controlled content cannot
 * invoke an arbitrary app.
 */
export const isSafeExternalUrl = (rawUrl: string): boolean => {
  const url = parseSafeExternalUrl(rawUrl);
  return Boolean(url && (isSafeHttpUrl(url) || isSafeMailtoUrl(url) || isSafeTelUrl(url)));
};
