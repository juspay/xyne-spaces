/**
 * The SDK SSO request a logged-out user was approving when they were sent to
 * log in. OAuth drops URL params, so the code waits here and the login flow
 * (AuthScreen or authMachine, whichever finishes first) returns the user to
 * `/sdk-sso/authorize`. Both read and clear it through these helpers, so it is
 * used at most once.
 *
 * Stored with a timestamp and ignored after the request's own 5-minute
 * lifetime, so an abandoned attempt never hijacks a later, unrelated login.
 */

const PENDING_KEY = 'pending_sdk_sso_user_code';

/** Matches the backend's device-request TTL. */
const PENDING_TTL_MS = 5 * 60 * 1000;

interface PendingSdkSso {
  userCode: string;
  storedAt: number;
}

/** Remember the request before redirecting to login. */
export function storePendingSdkSso(userCode: string): void {
  const value: PendingSdkSso = { userCode, storedAt: Date.now() };
  localStorage.setItem(PENDING_KEY, JSON.stringify(value));
}

/** The pending user code, or null if there is none or it is older than 5 minutes. */
export function getPendingSdkSso(): string | null {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingSdkSso>;
    if (
      typeof value.userCode === 'string' &&
      typeof value.storedAt === 'number' &&
      Date.now() - value.storedAt < PENDING_TTL_MS
    ) {
      return value.userCode;
    }
  } catch {
    // Unparseable, e.g. the bare string an older build stored
  }
  localStorage.removeItem(PENDING_KEY);
  return null;
}

/** Forget the pending request. */
export function clearPendingSdkSso(): void {
  localStorage.removeItem(PENDING_KEY);
}

/** Take the pending user code and clear it, so only one caller acts on it. */
export function takePendingSdkSso(): string | null {
  const userCode = getPendingSdkSso();
  clearPendingSdkSso();
  return userCode;
}
