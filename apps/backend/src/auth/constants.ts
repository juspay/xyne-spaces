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
 * The encryption fingerprint the dashboard echoes on encrypted bodies. NOT a session credential
 * (it is a sha256, not a token): `getClientSessionFingerprint` is its only reader, and only as a
 * fallback for requests that carry no session credential of their own.
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

/**
 * Redis watermark (epoch seconds) after a change to what the access JWT freezes for an account:
 * workspace role, org role, or membership. An access token whose `iat` is older than the
 * watermark is stale and must be re-minted from `xs` instead of trusted. TTL = longest JWT TTL,
 * because no token minted before the stamp can outlive that.
 */
export function claimsStaleKey(accountId: string): string {
  return `auth:claims_stale:${accountId}`;
}

/**
 * Device key of the one session row that server-to-server minting (claw-auth, scheduled jobs)
 * pins its tokens to. Deliberately NOT a real device: a user's own device logging out must not
 * tombstone the token a background job is holding, and the row must not count as "the user is
 * logged in somewhere" either (see `hasActiveSession`).
 */
export const S2S_DEVICE_KEY_PREFIX = 's2s:';

export function s2sDeviceKey(accountId: string): string {
  return `${S2S_DEVICE_KEY_PREFIX}${accountId}`;
}


/** `xd` cookie lifetime. */
export const DEVICE_COOKIE_MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
