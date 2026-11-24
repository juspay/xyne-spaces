/**
 * Cookies the dashboard WebView needs to be signed in: the `xs` refresh cookie, the
 * workspace JWTs (`xyne_ws_<workspaceId>_token`) and the `xyne_last_workspace` pointer.
 * The dashboard sends the JWT on every request and refreshes it from `xs` itself.
 *
 * Keep this deliberately narrow. The native API origin also holds the pending sign-in
 * cookie and provider cookies, which must never be copied to a WebView origin.
 */
export const DASHBOARD_REFRESH_COOKIE_NAME = 'xs';
const LAST_WORKSPACE_COOKIE_NAME = 'xyne_last_workspace';
const WORKSPACE_TOKEN_COOKIE_NAME = /^xyne_ws_[A-Za-z0-9_-]+_token$/;

export function isDashboardSessionCookieName(name: string): boolean {
  return (
    name === DASHBOARD_REFRESH_COOKIE_NAME ||
    name === LAST_WORKSPACE_COOKIE_NAME ||
    WORKSPACE_TOKEN_COOKIE_NAME.test(name)
  );
}

export type DashboardCookie = Record<string, unknown>;

/**
 * Select only the session cookies that the dashboard is allowed to receive, in a stable
 * order. Invalid values are ignored rather than passed to the native cookie module.
 */
export function selectDashboardSessionCookies(
  sourceCookies: Record<string, unknown> | null | undefined,
): DashboardCookie[] {
  const selected: DashboardCookie[] = [];

  for (const cookieName of Object.keys(sourceCookies ?? {}).sort()) {
    if (!isDashboardSessionCookieName(cookieName)) {
      continue;
    }
    const value = sourceCookies?.[cookieName];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }

    const cookie = value as DashboardCookie;
    if (typeof cookie['value'] !== 'string' || cookie['value'].length === 0) {
      continue;
    }

    selected.push({
      ...cookie,
      // Do not trust a mismatched name returned by a native implementation.
      name: cookieName,
    });
  }

  return selected;
}

/** Whether the selection can sign the dashboard in: without `xs` it cannot refresh. */
export function hasDashboardRefreshCookie(selectedCookies: DashboardCookie[]): boolean {
  return selectedCookies.some(cookie => cookie['name'] === DASHBOARD_REFRESH_COOKIE_NAME);
}

function readCookieValue(cookie: unknown): string | null {
  if (typeof cookie === 'string') return cookie;
  if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie)) return null;
  const value = (cookie as DashboardCookie)['value'];
  return typeof value === 'string' ? value : null;
}

/** Confirm that every selected session cookie reached the WebView cookie store. */
export function areDashboardSessionCookiesSynchronized(
  destinationCookies: Record<string, unknown> | null | undefined,
  selectedCookies: DashboardCookie[],
): boolean {
  return selectedCookies.every(cookie => {
    const name = cookie['name'];
    const expectedValue = readCookieValue(cookie);
    if (typeof name !== 'string' || expectedValue === null || expectedValue.length === 0) {
      return false;
    }
    return readCookieValue(destinationCookies?.[name]) === expectedValue;
  });
}
