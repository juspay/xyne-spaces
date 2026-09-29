import { createSecretHandler } from '../secretHandler.js';
import type { SecretHandler } from '../secretHandler.js';

const GITHUB_API_TIMEOUT_MS = 30_000;

/**
 * Confirms a candidate GitHub token is actually valid by hitting the one
 * endpoint that works for any PAT regardless of which repos it can access:
 * GET /user returns 200 + the authenticated identity if the token is good,
 * 401 if it's rejected. No self-service rotation API exists for a
 * classic/fine-grained PAT (a human must generate a new one), so there's no
 * rotate function — `rotate` stays createSecretHandler()'s default (null).
 */
export async function verifyGithubToken(value: string): Promise<boolean> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${value}`,
    },
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
  });
  return response.ok;
}

/** Ready-to-use handler — a consumer just imports this and drops it into their registry. */
export const githubToken: SecretHandler = createSecretHandler({ verify: verifyGithubToken });
