/** Top-level login surfaces that must not wait on session or auto-bootstrap local auth. */
export const PUBLIC_LOGIN_PATHS = ['/auth', '/onboarding'] as const;

export type PublicLoginPath = (typeof PUBLIC_LOGIN_PATHS)[number];

export function isPublicLoginPath(pathname: string): pathname is PublicLoginPath {
  return pathname === '/auth' || pathname === '/onboarding';
}

/** Local Vite may mint a session for app routes. /auth and /onboarding always show the wall. */
export function isLocalDevAuthBootstrapPath(
  pathname: string,
  localDevAuthEnabled: boolean,
): boolean {
  return localDevAuthEnabled && !isPublicLoginPath(pathname);
}
