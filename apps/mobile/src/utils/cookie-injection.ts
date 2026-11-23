/**
 * Cookie injection for WebView - injects session cookies from auth exchange response
 * so the dashboard/Canvas loads authenticated without re-prompting for login.
 */

import { Platform } from 'react-native';
import CookieManager from '@react-native-cookies/cookies';
import type { Cookie } from '@react-native-cookies/cookies';
import {
  enqueueAuthCookieMutation,
  getAuthOperation,
  getAuthSessionGeneration,
  isAuthScopeCurrent,
} from '@/src/services/authSessionLifecycle';
import {
  PENDING_AUTH_COOKIE,
  XYNE_LAST_WORKSPACE_COOKIE,
  REFRESH_SESSION_URL,
} from '@/src/utils/apiCookieHeader';
import {
  DASHBOARD_REFRESH_COOKIE_NAME,
  isDashboardSessionCookieName,
} from '@/src/utils/dashboardWebViewCookiePolicy';

const SPLIT_COOKIE_REGEX = /,\s*(?=[^;,]+=)/g;

/**
 * The only cookies the WebView itself reads: the dashboard's session (`xs`, the workspace
 * JWTs, `xyne_last_workspace`) and the pending sign-in cookie for finishing onboarding.
 * Mirroring anything else into the WKWebView store costs a main-thread round trip per
 * cookie for no benefit.
 */
function isWebViewCookieName(name: string): boolean {
  return name === PENDING_AUTH_COOKIE || isDashboardSessionCookieName(name);
}

/**
 * Normalize Set-Cookie header for local dev (http, different ports).
 * - SameSite=Lax for http
 * - Strip Secure when using http://
 */
function normalizeCookieHeaderForDev(cookieHeader: string, origin: string): string {
  if (!origin.startsWith('http://')) {
    return cookieHeader;
  }

  let normalized = cookieHeader;
  if (/samesite=/i.test(normalized)) {
    normalized = normalized.replace(/SameSite=[^;]+/i, 'SameSite=Lax');
  } else {
    normalized = `${normalized}; SameSite=Lax`;
  }
  normalized = normalized.replace(/;?\s*Secure/gi, '');
  return normalized;
}

/**
 * Extract cookie name from Set-Cookie header.
 */
function extractCookieName(cookieHeader: string): string | null {
  const match = /^\s*([^=]+)=/.exec(cookieHeader);
  if (!match) return null;
  const name = match[1]?.trim();
  return name && name.length > 0 ? name : null;
}

/**
 * Collect all Set-Cookie header values from response headers.
 * Handles both string and string[] (e.g. from axios).
 */
export function collectSetCookieHeaders(headers: Record<string, string | string[]>): string[] {
  const cookieHeaders: string[] = [];

  for (const [key, value] of Object.entries(headers)) {
    if (!key || key.toLowerCase() !== 'set-cookie' || !value) continue;

    const values: string[] = Array.isArray(value) ? value : [value];

    for (const v of values) {
      const str = typeof v === 'string' ? v : String(v);
      str
        .split(/\r?\n+/)
        .flatMap(part => part.split(SPLIT_COOKIE_REGEX))
        .map(part => part.trim())
        .filter(part => part.length > 0)
        .forEach(part => cookieHeaders.push(part));
    }
  }

  return cookieHeaders;
}

/**
 * Inject session cookies from auth exchange response into the WebView cookie store.
 * Call this after receiving a successful response from /v2/auth/exchange-mobile.
 */
export async function injectCookiesFromResponse(
  origin: string,
  headers: Record<string, string | string[]>,
  options?: { waitForPropagation?: boolean; generation?: number; operation?: number },
): Promise<void> {
  // This can run detached from the response that produced it, so a logout can land
  // half way through. Every write is gated on the session (and auth operation) that
  // was current when the request started: a cookie belonging to the previous user
  // must never be written back after `clearStoredAuth` has emptied the jar, which
  // would quietly keep that user's session alive in the WebView.
  const generation = options?.generation ?? getAuthSessionGeneration();
  const operation = options?.operation ?? getAuthOperation();
  const isCurrent = (): boolean => isAuthScopeCurrent(generation, operation);
  try {
    await enqueueAuthCookieMutation(
      generation,
      () =>
        injectCookiesFromResponseUnsafe(origin, headers, isCurrent, options?.waitForPropagation),
      isCurrent,
    );
  } catch (error) {
    // Some callers don't await this, so an escaping rejection would become an
    // unhandled promise rejection rather than a failed request.
    console.warn('[CookieInjection] Cookie sync failed:', error);
  }
}

async function injectCookiesFromResponseUnsafe(
  origin: string,
  headers: Record<string, string | string[]>,
  isCurrent: () => boolean,
  waitForPropagation?: boolean,
): Promise<void> {
  if (!isCurrent()) {
    return;
  }

  const cookieHeaders = collectSetCookieHeaders(headers);
  if (cookieHeaders.length === 0) {
    return;
  }

  for (const cookieHeader of cookieHeaders) {
    if (!cookieHeader) continue;
    if (!isCurrent()) return;
    const normalized = normalizeCookieHeaderForDev(cookieHeader, origin);
    try {
      const persisted = await CookieManager.setFromResponse(origin, normalized);
      console.log('[CookieInjection] Cookie persisted:', !!persisted, 'for', origin);
      if (!persisted) {
        console.warn('[CookieInjection] Failed to persist cookie:', cookieHeader.split('=')[0]);
      }
    } catch (err) {
      console.warn('[CookieInjection] Error persisting cookie:', err);
    }
  }

  // iOS: sync to WKWebView store. Only the session cookies the WebView actually
  // reads are mirrored; the ordinary jar above already holds everything else, and
  // Android's own requests read that jar through `buildApiCookieHeader`.
  if (Platform.OS === 'ios') {
    const names = cookieHeaders
      .map(h => extractCookieName(h))
      .filter((n): n is string => !!n && isWebViewCookieName(n));

    if (names.length > 0 && isCurrent()) {
      try {
        // `xs` is path-scoped to the refresh endpoint, so the origin alone does not list it.
        const cookies = {
          ...(await CookieManager.get(origin)),
          ...(names.includes(DASHBOARD_REFRESH_COOKIE_NAME)
            ? await CookieManager.get(REFRESH_SESSION_URL)
            : {}),
        };

        for (const name of names) {
          if (!isCurrent()) return;
          const cookie = cookies[name];
          if (cookie && typeof cookie === 'object') {
            try {
              await CookieManager.set(origin, cookie as Cookie, true);
            } catch {
              // Ignore individual sync failures
            }
          }
        }
      } catch {
        // Ignore sync failures
      }
    }
  }

  if (Platform.OS === 'android') {
    if (!isCurrent()) return;
    await CookieManager.flush();
  }

  // Only the auth-exchange handoff needs the WebView store to have settled before
  // the caller continues. Every other response used to pay this unconditionally.
  if (waitForPropagation) {
    await new Promise<void>(r => setTimeout(r, __DEV__ ? 250 : 50));
  }
}

/**
 * The backend's default lifetime for the pointer (`SESSION_EXPIRY_DAYS`, 180). It is
 * configurable there, but the backend rewrites the cookie with its own value on every
 * refresh, switch and login, so this only has to outlive the next one.
 */
const LAST_WORKSPACE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/**
 * Points the jar's `xyne_last_workspace` at `workspaceId` when it says otherwise. The
 * refresh endpoint mints the JWT for the workspace this cookie names (it ignores
 * `x-workspace-id`), so a pointer left on another workspace (a switch that succeeded on
 * the server but was rolled back here) would refresh the wrong one forever. Written
 * through the same path as a real `Set-Cookie`, with the attributes `setAccessCookies`
 * gives it in production; on local http that path drops `Secure` as it does for the
 * backend's own cookies.
 */
export async function pointLastWorkspaceAt(
  origin: string,
  workspaceId: string,
  scope: { generation: number; operation: number },
): Promise<void> {
  let current: string | undefined;
  try {
    const cookies = await CookieManager.get(origin);
    const entry = cookies[XYNE_LAST_WORKSPACE_COOKIE];
    current = typeof entry === 'object' && entry !== null ? entry.value : undefined;
  } catch {
    return;
  }
  if (current === workspaceId) {
    return;
  }
  await injectCookiesFromResponse(
    origin,
    {
      'set-cookie': `${XYNE_LAST_WORKSPACE_COOKIE}=${workspaceId}; Path=/; Max-Age=${LAST_WORKSPACE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
    },
    scope,
  );
}
