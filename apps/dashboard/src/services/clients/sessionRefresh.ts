/**
 * Session refresh, shared by every transport the dashboard uses to reach the backend.
 *
 * The backend never refreshes a token on its own: an expired workspace JWT cookie is a
 * plain 401. The only place a new JWT is minted is `GET /auth/refresh-session`, which the
 * browser sends the `xs` refresh cookie to (and to nothing else). So every transport does
 * the same thing on a 401 from our backend:
 *
 *   refreshable code, not already retried, not the refresh call itself
 *     → refresh once → re-send the request
 *
 * "Refreshable" comes from the 401 body's `code` (see `isRefreshableAuthFailure`): only a
 * missing or expired JWT is worth a refresh. An invalid token, a revoked session or a
 * removed user is final, and the caller goes to login without the extra round-trip.
 *
 * The three transports plug into this module rather than carrying their own copy:
 *   - `apiInstance` (services/clients/apiClient.ts) — its response interceptor
 *   - bare `axios` — the default-instance interceptor registered in utils/logger.ts
 *   - `fetch` — the `window.fetch` wrapper registered in utils/logger.ts
 * The XyneAI Web Worker cannot see the fetch wrapper; it reports a 401 to the manager,
 * which calls `refreshSessionOnce` and restarts the stream.
 *
 * This file imports nothing from the rest of the app so that both apiClient.ts and
 * logger.ts can import it without a cycle.
 */

import axios from 'axios';
import { API_BASE_URL } from '../../config';

export type RefreshOutcome = 'ok' | 'dead' | 'transient';

const REFRESH_SESSION_PATH = '/auth/refresh-session';

// ── 401 reason ───────────────────────────────────────────────────────────────
// Mirrors `AuthFailureCode` / `REFRESHABLE_AUTH_FAILURE_CODES` in the backend's
// middleware/auth.ts. A refresh can only help when the session is still alive and just
// the JWT is gone: TOKEN_MISSING (the browser dropped the cookie at expiry, the usual
// case) or TOKEN_EXPIRED. TOKEN_INVALID, SESSION_REVOKED, USER_REMOVED and
// EMAIL_DOMAIN_NOT_ALLOWED are final.

const REFRESHABLE_AUTH_FAILURE_CODES: ReadonlySet<string> = new Set([
  'TOKEN_MISSING',
  'TOKEN_EXPIRED',
]);

/** The `code` string from a 401 JSON body, if the body has one. */
export const readAuthFailureCode = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

/**
 * Whether a 401 is worth a `/auth/refresh-session` call. A body without a `code` (routes
 * outside the auth middleware, non-JSON bodies) keeps the old behaviour and refreshes.
 */
export const isRefreshableAuthFailure = (body: unknown): boolean => {
  const code = readAuthFailureCode(body);
  return code === undefined || REFRESHABLE_AUTH_FAILURE_CODES.has(code);
};

/** `isRefreshableAuthFailure` for a fetch Response; reads a clone so the body stays usable. */
export const isRefreshableAuthFailureResponse = async (response: Response): Promise<boolean> => {
  try {
    return isRefreshableAuthFailure(await response.clone().json());
  } catch {
    return true;
  }
};

/** True for `/auth/refresh-session` itself: a 401 there is final, never retried. */
export const isRefreshSessionUrl = (url: string | undefined): boolean =>
  !!url && url.includes(REFRESH_SESSION_PATH);

/** True for URLs under API_BASE_URL (ours); third-party requests are never refreshed. */
export const isBackendUrl = (rawUrl: string): boolean => {
  try {
    const base = new URL(API_BASE_URL, window.location.href).href.replace(/\/+$/, '');
    const target = new URL(rawUrl, window.location.href).href;
    return target === base || target.startsWith(`${base}/`) || target.startsWith(`${base}?`);
  } catch {
    return false;
  }
};

// ── Proactive refresh ────────────────────────────────────────────────────────
// Cookie-only loads (<img>, <video>, <audio>, pdf.js) cannot retry on 401, so the
// JWT is refreshed a little before it expires. The cookie is httpOnly, so the
// expiry comes from the backend: every response that mints a JWT (refresh-session,
// validate, login-workspace, switch-workspace) carries `accessTokenExpiresAt`.

const REFRESH_SKEW_MS = 2 * 60 * 1000;
let accessTokenExpiresAt: number | null = null;

/** Record the JWT expiry a backend response reported (ignored when absent or malformed). */
export const noteAccessTokenExpiry = (expiresAt: unknown): void => {
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > 0) {
    accessTokenExpiresAt = expiresAt;
  }
};

export const clearAccessTokenExpiry = (): void => {
  accessTokenExpiresAt = null;
};

const isAccessTokenExpiringSoon = (): boolean =>
  accessTokenExpiresAt !== null && accessTokenExpiresAt - Date.now() < REFRESH_SKEW_MS;

// ── The refresh call ─────────────────────────────────────────────────────────
// Single-flight: concurrent 401s share one call. Plain axios (not apiInstance) and
// marked so the interceptors never re-enter on its own 401.

let refreshInFlight: Promise<RefreshOutcome> | null = null;

export const refreshSessionOnce = (): Promise<RefreshOutcome> =>
  (refreshInFlight ??= axios
    .get<{ accessTokenExpiresAt?: number }>(`${API_BASE_URL}${REFRESH_SESSION_PATH}`, {
      withCredentials: true,
    })
    .then((response): RefreshOutcome => {
      noteAccessTokenExpiry(response.data?.accessTokenExpiresAt);
      return 'ok';
    })
    .catch((e): RefreshOutcome => {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        clearAccessTokenExpiry();
        return 'dead';
      }
      return 'transient';
    })
    .finally((): void => {
      refreshInFlight = null;
    }));

/** Refresh ahead of expiry when the recorded expiry is near. Never throws. */
export const ensureFreshSession = async (): Promise<void> => {
  if (!isAccessTokenExpiringSoon()) return;
  await refreshSessionOnce();
};

// The JWT lives 15 min (JWT_EXPIRATION_SECONDS). An open but idle tab makes no
// apiInstance request, so a timer keeps it fresh too: cookie-only media loads and
// the Electron main process (which reads the same cookie jar for agent calls) would
// otherwise hold an expired JWT. Hidden-tab throttling still fires at least once a
// minute, inside the 2-min skew.
const PROACTIVE_REFRESH_INTERVAL_MS = 60 * 1000;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void ensureFreshSession();
  });
  window.setInterval(() => void ensureFreshSession(), PROACTIVE_REFRESH_INTERVAL_MS);
}

// ── Transport helpers ────────────────────────────────────────────────────────

/** Config fields the axios retry needs; `_retry` marks a request that was already re-sent once. */
export interface RetryableRequestConfig {
  url?: string;
  baseURL?: string;
  _retry?: boolean;
}

/** Absolute URL of an axios request (baseURL + url), for the backend check. */
export const resolveAxiosUrl = (config: RetryableRequestConfig): string =>
  config.baseURL && config.url && !/^[a-z][a-z\d+.-]*:|^\/\//i.test(config.url)
    ? `${config.baseURL.replace(/\/+$/, '')}/${config.url.replace(/^\/+/, '')}`
    : (config.url ?? '');

/**
 * Whether a failed axios request should go through refresh-and-retry: a 401 from our
 * backend with a refreshable `code` (see `isRefreshableAuthFailure`), not the refresh call,
 * not already retried. Marks the config as retried.
 */
export const claimAxiosRetry = (
  status: number | undefined,
  config: RetryableRequestConfig | undefined,
  body?: unknown,
): boolean => {
  if (status !== 401 || !config || config._retry === true) return false;
  if (!isRefreshableAuthFailure(body)) return false;
  const url = resolveAxiosUrl(config);
  if (!isBackendUrl(url) || isRefreshSessionUrl(url)) return false;
  config._retry = true;
  return true;
};
