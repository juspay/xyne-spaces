import type { RefreshSessionResult } from './AuthServices';
import { decodeAuthJwtClaims } from './authJwtClaims';

export type RefreshFailureKind = Extract<RefreshSessionResult, { ok: false }>['kind'];

export const TOKEN_REFRESH_LEAD_SECONDS = 300;

/** Consecutive dead-session refusals tolerated before the user is signed out. */
export const MAX_DEAD_SESSION_ATTEMPTS = 3;

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
 * The session cookie itself was refused, so refreshing again cannot help unless
 * the refusal was a fluke. Every other failure is a blip we keep retrying.
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
 * forever rather than signing out — only a dead session cookie logs the user
 * out, and only after it has refused us repeatedly.
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
