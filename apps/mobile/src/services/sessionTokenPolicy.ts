import type { RefreshSessionResult } from './AuthServices';
import { decodeAuthJwtClaims } from './authJwtClaims';

export type RefreshFailureKind = Extract<RefreshSessionResult, { ok: false }>['kind'];

export const TOKEN_REFRESH_LEAD_SECONDS = 300;

/**
 * Dead-session refusals before the user is signed out. One: only a refusal carrying the
 * backend's session-ended code counts (see `isSessionEndedRefusal`), and repeating the
 * refresh cannot bring that session back.
 */
export const MAX_DEAD_SESSION_ATTEMPTS = 1;

/** Backoff ladder for `needs-auth` recovery; the last tier repeats. */
const AUTH_RETRY_DELAYS_MS = [500, 1_500, 3_000, 10_000, 30_000] as const;

export function getAuthRetryDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), AUTH_RETRY_DELAYS_MS.length - 1);
  return AUTH_RETRY_DELAYS_MS[index]!;
}

/** ms until we should refresh. `null` if no `exp`; `0` if already due. */
export function getMsUntilProactiveRefresh(
  token: string,
  leadSeconds: number = TOKEN_REFRESH_LEAD_SECONDS,
): number | null {
  const exp = decodeAuthJwtClaims(token)?.exp;
  if (typeof exp !== 'number') {
    return null;
  }
  return Math.max(0, exp * 1000 - leadSeconds * 1000 - Date.now());
}

/**
 * Delay before the next proactive refresh after one succeeded. A refresh can
 * hand back a token that is still due — the cookie was not rotated, `exp` is
 * missing, or the new `exp` is already inside the lead window — so fall back to
 * the backoff ladder rather than re-arming at 0ms and spinning.
 */
export function getProactiveRearmDelay(
  token: string,
  attempt: number,
): { delayMs: number; stillDue: boolean } {
  const delayMs = getMsUntilProactiveRefresh(token);
  if (delayMs !== null && delayMs > 0) {
    return { delayMs, stillDue: false };
  }
  return { delayMs: getAuthRetryDelay(attempt), stillDue: true };
}

/**
 * 401 codes from the auth middleware (`AuthFailureCode` in the backend's middleware/auth.ts)
 * that a session refresh can fix: the JWT is missing or expired, but the session may still
 * be alive. Every other code is final.
 */
const REFRESHABLE_AUTH_CODES = new Set(['TOKEN_MISSING', 'TOKEN_EXPIRED']);

/**
 * The final 401 codes, on which the backend says the client should log out. TOKEN_INVALID
 * is one: a bad signature, claims that do not match the request, or a user that no longer
 * exists. REFRESH_INVALID comes from the routes that use the session behind the JWT
 * (refresh, switch-workspace, create-workspace) when that session is gone. A 401 for a
 * request sent under an account or workspace that is no longer the current one never
 * signs out (see withSessionRefreshOn401).
 */
const SESSION_ENDED_AUTH_CODES = new Set([
  'TOKEN_INVALID',
  'REFRESH_INVALID',
  'SESSION_REVOKED',
  'USER_REMOVED',
  'EMAIL_DOMAIN_NOT_ALLOWED',
]);

/**
 * The `code` of a 401 body, if it has one. File downloads report the body as a string,
 * so JSON text is read too.
 */
function readAuthFailureCode(statusCode: number, body: unknown): string | undefined {
  if (statusCode !== 401) {
    return undefined;
  }
  let parsed = body;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  const code =
    typeof parsed === 'object' && parsed !== null ? (parsed as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Whether a 401 carries one of the codes a refresh can fix. A 401 without a code comes
 * from something other than the auth middleware, which a refresh cannot fix either.
 */
export function isRefreshableAuthFailure(statusCode: number, body: unknown): boolean {
  const code = readAuthFailureCode(statusCode, body);
  return code !== undefined && REFRESHABLE_AUTH_CODES.has(code);
}

/**
 * Whether an API 401 says the session is over: the token is invalid or its user no longer
 * exists (TOKEN_INVALID), the session behind it is gone (REFRESH_INVALID), logged out
 * (SESSION_REVOKED), the user left or was deactivated (USER_REMOVED), or the email domain
 * is blocked. A refresh cannot bring it back and every
 * later request is refused the same way, so the app signs out.
 */
export function isSessionEndedAuthFailure(statusCode: number, body: unknown): boolean {
  const code = readAuthFailureCode(statusCode, body);
  return code !== undefined && SESSION_ENDED_AUTH_CODES.has(code);
}

/**
 * Whether a refresh-session refusal is the backend ending the session: 401
 * REFRESH_INVALID (`xs` missing, revoked, expired or reused), 403
 * WORKSPACE_ACCESS_DENIED (left or deactivated; the backend has already revoked the
 * session) or 401 `email_domain_not_allowed`. A 401/403 without one of these comes
 * from something in front of the backend (gateway, WAF, mTLS ingress) and says
 * nothing about the session.
 */
export function isSessionEndedRefusal(statusCode: number, body: unknown): boolean {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const { code, error } = body as { code?: unknown; error?: unknown };
  if (statusCode === 401) {
    return code === 'REFRESH_INVALID' || error === 'email_domain_not_allowed';
  }
  if (statusCode === 403) {
    return code === 'WORKSPACE_ACCESS_DENIED';
  }
  return false;
}

/**
 * The backend ended the session (see `isSessionEndedRefusal`), so refreshing again
 * cannot help. Every other failure is a blip we keep retrying.
 */
export function isDeadSessionFailure(kind: RefreshFailureKind): boolean {
  return kind === 'unauthorized';
}

export type AuthRetryState = {
  /** Every consecutive failure, used for backoff only. */
  attempts: number;
  /** Consecutive dead-session refusals, the only thing that can sign the user out. */
  deadSessionAttempts: number;
};

export const INITIAL_AUTH_RETRY_STATE: AuthRetryState = { attempts: 0, deadSessionAttempts: 0 };

export type AuthRetryDecision =
  { action: 'sign-out' } | { action: 'retry'; delayMs: number; state: AuthRetryState };

/**
 * Decides what to do after a failed refresh. Transient failures back off
 * forever rather than signing out — only the backend ending the session logs the
 * user out.
 */
export function nextAuthRetry(kind: RefreshFailureKind, state: AuthRetryState): AuthRetryDecision {
  const nextState: AuthRetryState = {
    attempts: state.attempts + 1,
    deadSessionAttempts: isDeadSessionFailure(kind) ? state.deadSessionAttempts + 1 : 0,
  };

  if (nextState.deadSessionAttempts >= MAX_DEAD_SESSION_ATTEMPTS) {
    return { action: 'sign-out' };
  }

  return { action: 'retry', delayMs: getAuthRetryDelay(state.attempts), state: nextState };
}
