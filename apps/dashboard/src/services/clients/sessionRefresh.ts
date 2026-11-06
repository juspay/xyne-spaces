/**
 * Session refresh, shared by every transport the dashboard uses to reach the backend.
 *
 * The backend never refreshes a token on its own: an expired workspace JWT cookie is a
 * plain 401. The only place a new JWT is minted is `GET /auth/refresh-session`, which the
 * browser sends the `xs` refresh cookie to (and to nothing else). So every transport does
 * the same thing on a 401 from our backend:
 *
 *   not already retried, not the refresh call itself → refresh once → re-send the request
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
 * backend, not the refresh call, not already retried. Marks the config as retried.
 */
export const claimAxiosRetry = (
  status: number | undefined,
  config: RetryableRequestConfig | undefined,
): boolean => {
  if (status !== 401 || !config || config._retry === true) return false;
  const url = resolveAxiosUrl(config);
  if (!isBackendUrl(url) || isRefreshSessionUrl(url)) return false;
  config._retry = true;
  return true;
};
