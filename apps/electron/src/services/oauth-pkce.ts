import { createHash, randomBytes } from 'crypto';

const LOGIN_PATH = /\/auth\/(microsoft\/)?login$/;

let loginCodeVerifier: string | null = null;

/**
 * Adds a fresh S256 `code_challenge` to an Electron OAuth login URL and keeps its verifier in
 * memory for /auth/exchange-electron. Other URLs are returned unchanged.
 */
export function withLoginCodeChallenge(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!LOGIN_PATH.test(parsed.pathname) || parsed.searchParams.get('platform') !== 'electron') return url;

  const verifier = randomBytes(32).toString('base64url');
  loginCodeVerifier = verifier;
  parsed.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
  return parsed.toString();
}

/** Verifier of the latest login this app started, or null. */
export function getLoginCodeVerifier(): string | null {
  return loginCodeVerifier;
}
