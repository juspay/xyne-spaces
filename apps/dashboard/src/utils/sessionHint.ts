/**
 * Boot-time session hint.
 *
 * The real session lives in an httpOnly cookie the frontend cannot read, so
 * the auth machine needs a persisted marker to decide between "try
 * /auth/validate" and "go straight to the login screen" on a cold load. A
 * plain boolean flag is enough for that decision — the user id itself never
 * needs to be persisted.
 *
 * Reads also honour the legacy `user_id` key so sessions created before this
 * flag existed keep validating; writes and clears remove it.
 */

const HAS_SESSION_KEY = 'has_session';
const LEGACY_USER_ID_KEY = 'user_id';

export const markSessionHint = (): void => {
  localStorage.setItem(HAS_SESSION_KEY, 'true');
  localStorage.removeItem(LEGACY_USER_ID_KEY);
};

export const hasSessionHint = (): boolean =>
  localStorage.getItem(HAS_SESSION_KEY) === 'true' ||
  !!localStorage.getItem(LEGACY_USER_ID_KEY);

export const clearSessionHint = (): void => {
  localStorage.removeItem(HAS_SESSION_KEY);
  localStorage.removeItem(LEGACY_USER_ID_KEY);
};
