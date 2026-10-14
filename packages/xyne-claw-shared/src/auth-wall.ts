/**
 * Recognises sign-in pages, so a fetch that lands on one can be reported as
 * "needs the user's sign-in" instead of a bare HTTP error.
 *
 * Used by claw-auth's webfetch (redirects to a login page) and by the
 * wait-for-sign-in tool (has the panel tab left the login page yet?).
 */

/** Hosts whose pages are sign-in pages whatever the path. */
const LOGIN_HOSTS = new Set(["accounts.google.com", "login.microsoftonline.com", "login.live.com"]);
const LOGIN_HOST_SUFFIXES = [".okta.com", ".auth0.com"];
/** A path segment that, on its own, names a sign-in page (`/login`, `/u/login`, `/users/sign_in`). */
const LOGIN_SEGMENTS = new Set(["login", "signin", "sign-in", "sign_in", "sso", "saml"]);

export function isLoginUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (LOGIN_HOSTS.has(host)) return true;
  if (LOGIN_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const segments = parsed.pathname.toLowerCase().split("/").filter(Boolean);
  if (segments.some((segment) => LOGIN_SEGMENTS.has(segment))) return true;
  for (let i = 0; i < segments.length - 1; i++) {
    if ((segments[i] === "oauth" || segments[i] === "oauth2") && segments[i + 1] === "authorize") return true;
  }
  return false;
}
