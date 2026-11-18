import {
  getAuthOperation,
  getAuthSessionGeneration,
  isAuthScopeCurrent,
} from '@/src/services/authSessionLifecycle';
import {
  isRefreshableAuthFailure,
  isSessionEndedAuthFailure,
} from '@/src/services/sessionTokenPolicy';
import { getActiveWorkspaceId } from './activeWorkspace';

/**
 * Renews the access JWT from the refresh cookie. Registered by AuthServices, which sits
 * above the transport and so cannot be imported from it.
 * - `refreshed`: the jar now holds a fresh JWT.
 * - `session-ended`: the backend ended the session; the user is being signed out.
 * - `unavailable`: the session is still valid but could not be renewed right now
 *   (5xx, network).
 */
export type SessionRefreshOutcome = 'refreshed' | 'session-ended' | 'unavailable';
type SessionRefresher = (generation: number, operation: number) => Promise<SessionRefreshOutcome>;

let sessionRefresher: SessionRefresher | null = null;

export function setSessionRefresher(refresher: SessionRefresher): void {
  sessionRefresher = refresher;
}

/**
 * Ends the session after an API 401 that says it is over (see `isSessionEndedAuthFailure`).
 * Registered by AuthServices for the same reason as the refresher.
 */
let sessionEndedHandler: (() => void) | null = null;

export function setSessionEndedHandler(handler: () => void): void {
  sessionEndedHandler = handler;
}

/** Body standing in for the original 401 when the session is fine but was not renewed. */
export const SESSION_REFRESH_UNAVAILABLE_BODY = {
  error: 'Session refresh unavailable',
  code: 'SESSION_REFRESH_UNAVAILABLE',
  message: 'Could not reach the server to renew your session. Please try again.',
} as const;

/**
 * After a refresh that did not fix the 401, further 401s wait this long before refreshing
 * again, so a burst of requests does not each trigger one.
 */
const REFRESH_COOLDOWN_MS = 15_000;
let refreshCooldownUntil = 0;

interface SessionRefreshOn401<T> {
  /** Sends the request; called again for the one retry. */
  send: () => Promise<T>;
  /** Status and body of a result, to spot a refreshable 401. */
  readFailure: (result: T) => { statusCode: number; body: unknown };
  /** What to return instead of the 401 when the session is fine but was not renewed. */
  unavailable: () => T;
}

/**
 * Sends a request; on a refreshable 401 renews the session and sends it once more. Every
 * HTTP path (JSON, uploads, downloads, socket polling) goes through this, so none of them
 * fails on a JWT that simply expired.
 *
 * - The retry only goes out under the account and workspace the request was sent under:
 *   a sign-out, sign-in or switch in between returns the original 401 instead.
 * - A 401 saying the session is over (revoked, user removed) signs the user out at once,
 *   instead of after the next refresh is refused.
 * - A refresh that cannot help (unavailable, or refreshed yet still refused) puts later
 *   401s on a short cooldown, so a burst of requests does not refresh on every call.
 */
export async function withSessionRefreshOn401<T>({
  send,
  readFailure,
  unavailable,
}: SessionRefreshOn401<T>): Promise<T> {
  // Captured as the request goes out: `x-workspace-id` and the cookies are taken from
  // this state, and a retry rebuilds them from whatever is current by then.
  const generation = getAuthSessionGeneration();
  const operation = getAuthOperation();
  const workspaceId = getActiveWorkspaceId();
  const isScopeCurrent = (): boolean =>
    isAuthScopeCurrent(generation, operation) && getActiveWorkspaceId() === workspaceId;
  const isRefreshable = (result: T): boolean => {
    const { statusCode, body } = readFailure(result);
    return isRefreshableAuthFailure(statusCode, body);
  };
  // Only for the session the request went out under: a 401 for one already replaced by
  // a sign-in or switch says nothing about the current one.
  const endSessionIfOver = (result: T): T => {
    const { statusCode, body } = readFailure(result);
    if (isSessionEndedAuthFailure(statusCode, body) && isScopeCurrent()) {
      sessionEndedHandler?.();
    }
    return result;
  };

  const result = endSessionIfOver(await send());
  if (!sessionRefresher || !isRefreshable(result) || !isScopeCurrent()) {
    return result;
  }
  if (Date.now() < refreshCooldownUntil) {
    return unavailable();
  }
  const outcome = await sessionRefresher(generation, operation);
  if (outcome === 'unavailable') {
    refreshCooldownUntil = Date.now() + REFRESH_COOLDOWN_MS;
    return unavailable();
  }
  // Checked again after the refresh: a change while it ran means a resend would go out
  // as the new account or workspace.
  if (outcome === 'session-ended' || !isScopeCurrent()) {
    return result;
  }
  const retried = endSessionIfOver(await send());
  // Refreshed, yet still refused: the new token is not the one this request needs.
  refreshCooldownUntil = isRefreshable(retried) ? Date.now() + REFRESH_COOLDOWN_MS : 0;
  return retried;
}
