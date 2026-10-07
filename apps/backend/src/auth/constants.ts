/** Cookie and header names shared by the resolver, issuer, controllers and tests. */

/**
 * Opaque session token (`xs1_...`; a converted legacy session keeps its old `user_sessions.id`
 * as the value). httpOnly. ONE per device/browser. This is the refresh credential: every
 * per-workspace access JWT is minted from it.
 */
export const SESSION_COOKIE = 'xs';
/** Persistent device key (random uuid). httpOnly, long-lived, never cleared on logout. */
export const DEVICE_COOKIE = 'xd';
/** Per-workspace access JWT cookie: `xw_<workspaceId>`. httpOnly, TTL = JWT_EXPIRATION_SECONDS. */
export const ACCESS_COOKIE_PREFIX = 'xw_';
/** Legacy session cookie name. Read-only, except for mobile builds under the version gate (mirrored). */
export const LEGACY_SESSION_COOKIE = 'user_session_id';
/** Older alias some clients (claw, WebView bridge) forge; read only. */
export const OLD_SESSION_COOKIE = 'xyne_session';
/** Header alternative to SESSION_COOKIE for clients that cannot set cookies. */
export const SESSION_TOKEN_HEADER = 'x-session-token';
/**
 * Header alternative to LEGACY_SESSION_COOKIE. Read LAST: the dashboard echoes the encryption
 * fingerprint (a hash, not a token) in this header on encrypted bodies.
 */
export const LEGACY_SESSION_HEADER = 'x-session-id';
/** Workspace hint written by login/switch/create/join issuance and by a legacy conversion that found none. */
export const LAST_WORKSPACE_COOKIE = 'xyne_last_workspace';
/** Explicit workspace selector; wins over LAST_WORKSPACE_COOKIE. */
export const WORKSPACE_HEADER = 'x-workspace-id';
/** `electron` | `mobile` | `native` — platform of the calling client. */
export const PLATFORM_HEADER = 'x-platform';
/** Stable client device id (Electron clientSessionId, mobile deviceRegistry id). Becomes `deviceKey`. */
export const DEVICE_ID_HEADER = 'x-device-id';
/** Mobile OS (`ios` | `android`), sent by new mobile builds; old builds are sniffed from the user agent. */
export const APP_PLATFORM_HEADER = 'x-app-platform';
/** Mobile marketing version (`DeviceInfo.getVersion()`, e.g. `2.1.1`). */
export const APP_VERSION_HEADER = 'x-app-version';
/** Pending (pre-workspace) OAuth identity cookie. Identity only, never provider or session tokens. */
export const PENDING_AUTH_COOKIE = 'google_access_token';
export const PENDING_AUTH_MAX_AGE_MS = 10 * 60 * 1000;

export const LEGACY_WS_TOKEN_COOKIE_PREFIX = 'xyne_ws_';
export const LEGACY_WS_TOKEN_COOKIE_SUFFIX = '_token';

/** `xw_<workspaceId>` — the per-workspace access JWT cookie. */
export function accessCookieName(workspaceId: string): string {
  return `${ACCESS_COOKIE_PREFIX}${workspaceId}`;
}

export function isAccessCookieName(name: string): boolean {
  return name.startsWith(ACCESS_COOKIE_PREFIX) && name.length > ACCESS_COOKIE_PREFIX.length;
}

/** Legacy per-workspace JWT cookie (`xyne_ws_<ws>_token`). Read for old clients; written only under the mobile gate. */
export function legacyWsTokenCookieName(workspaceId: string): string {
  return `${LEGACY_WS_TOKEN_COOKIE_PREFIX}${workspaceId}${LEGACY_WS_TOKEN_COOKIE_SUFFIX}`;
}

export function isLegacyWsTokenCookieName(name: string): boolean {
  return name.startsWith(LEGACY_WS_TOKEN_COOKIE_PREFIX) && name.endsWith(LEGACY_WS_TOKEN_COOKIE_SUFFIX);
}

/** Redis tombstone for an auth session id; TTL = longest JWT TTL. */
export function revokedSidKey(sid: string): string {
  return `auth:revoked_sid:${sid}`;
}

/** `xd` cookie lifetime. */
export const DEVICE_COOKIE_MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
/** Re-mint the `xw_<ws>` access JWT from the session when it has less than this left. */
export const ACCESS_TOKEN_REFRESH_AHEAD_SECONDS = 5 * 60;
