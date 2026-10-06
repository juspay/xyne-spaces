/** Cookie and header names shared by the resolver, issuer, controllers and tests. */

/** Opaque account-session token (`xs1_...`). httpOnly. */
export const SESSION_COOKIE = 'xyne_session';
/** Header alternative to SESSION_COOKIE for clients that cannot set cookies. */
export const SESSION_TOKEN_HEADER = 'x-session-token';
/** Legacy `workflow.user_sessions` id. Still written for legacy-looking clients. */
export const LEGACY_SESSION_COOKIE = 'user_session_id';
/** Header alternative to LEGACY_SESSION_COOKIE. */
export const LEGACY_SESSION_HEADER = 'x-session-id';
/** Workspace hint written ONLY by login/switch/create/join issuance. */
export const LAST_WORKSPACE_COOKIE = 'xyne_last_workspace';
/** Explicit workspace selector; wins over LAST_WORKSPACE_COOKIE. */
export const WORKSPACE_HEADER = 'x-workspace-id';
/** `electron` | `mobile` — marks a legacy-looking client. */
export const PLATFORM_HEADER = 'x-platform';
/** Pending (pre-workspace) OAuth identity cookie. Identity only, never provider tokens. */
export const PENDING_AUTH_COOKIE = 'google_access_token';
export const PENDING_AUTH_MAX_AGE_MS = 10 * 60 * 1000;

export const WS_TOKEN_COOKIE_PREFIX = 'xyne_ws_';
export const WS_TOKEN_COOKIE_SUFFIX = '_token';

export function wsTokenCookieName(workspaceId: string): string {
  return `${WS_TOKEN_COOKIE_PREFIX}${workspaceId}${WS_TOKEN_COOKIE_SUFFIX}`;
}

export function isWsTokenCookieName(name: string): boolean {
  return name.startsWith(WS_TOKEN_COOKIE_PREFIX) && name.endsWith(WS_TOKEN_COOKIE_SUFFIX);
}

/** Redis tombstone for an auth session id; TTL = JWT TTL. */
export function revokedSidKey(sid: string): string {
  return `auth:revoked_sid:${sid}`;
}

/** `refresh-session` without a hint mints one JWT per active grant, capped here. */
export const MAX_REFRESH_TOKENS_PER_SESSION = 25;
