/**
 * Where the OAuth callback should send the browser back to.
 *
 * Without this the callback falls back to claw's own SPA, so a connector
 * started from Spaces finished on claw's home page. The current URL is used so
 * the user lands exactly where they were — every consumer already watches its
 * own URL for `?<type>_connected=true` and refetches.
 *
 * The server re-validates this against an origin allowlist; it is a hint, not
 * an instruction.
 */
export function currentOAuthReturnTo(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.location.href;
}
