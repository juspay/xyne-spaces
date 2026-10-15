/**
 * Cookies that are required by the focused dashboard WebView.
 *
 * Keep this list deliberately small. The native API origin can contain
 * provider, workspace, and access-token cookies that must never be copied to
 * a WebView origin.
 */
export const DASHBOARD_SESSION_COOKIE_NAMES = ['xyne_session', 'user_session_id'] as const;

export type DashboardCookie = Record<string, unknown>;

/**
 * Select only the session cookies that the dashboard is allowed to receive.
 * Invalid values are ignored rather than passed to the native cookie module.
 */
export function selectDashboardSessionCookies(
  sourceCookies: Record<string, unknown> | null | undefined,
): DashboardCookie[] {
  const selected: DashboardCookie[] = [];

  for (const cookieName of DASHBOARD_SESSION_COOKIE_NAMES) {
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
