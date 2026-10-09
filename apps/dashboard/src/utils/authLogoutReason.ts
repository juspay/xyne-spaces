/**
 * Why the app signed the user out, carried across the redirect to the login screen.
 *
 * An automatic sign-out — the session expired and a refresh could not save it — looks identical
 * to a cold start from the login screen: the user is simply back at "Log in to Xyne Spaces" with
 * no idea their session ended, and reads it as the app losing their login. The reason is written
 * just before the redirect and read once by the login screen.
 *
 * `sessionStorage`, not `localStorage`: the message belongs to this tab's redirect and must not
 * resurface in a new window opened days later. It survives the `window.location.reload()` the
 * sign-out path performs.
 */

const STORAGE_KEY = 'auth_logout_reason';

export const AuthLogoutReason = {
  /** A 401 that session refresh could not recover. */
  SESSION_EXPIRED: 'session_expired',
} as const;

export type AuthLogoutReasonType = (typeof AuthLogoutReason)[keyof typeof AuthLogoutReason];

const MESSAGES: Record<AuthLogoutReasonType, string> = {
  [AuthLogoutReason.SESSION_EXPIRED]: 'Your session expired. Please log in again to continue.',
};

export function setAuthLogoutReason(reason: AuthLogoutReasonType): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, reason);
  } catch {
    // Storage disabled or full — the sign-out itself must still proceed.
  }
}

/**
 * Reads and clears the reason. Consuming it on read means a manual reload of the login screen
 * does not keep repeating a message about a sign-out the user has already seen.
 */
export function takeAuthLogoutMessage(): string | null {
  try {
    const reason = sessionStorage.getItem(STORAGE_KEY);
    if (!reason) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return MESSAGES[reason as AuthLogoutReasonType] ?? null;
  } catch {
    return null;
  }
}
