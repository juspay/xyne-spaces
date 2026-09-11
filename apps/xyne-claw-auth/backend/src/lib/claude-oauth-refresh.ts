/**
 * Claude (Anthropic) OAuth access-token refresh.
 *
 * Anthropic subscription / Claude-Code OAuth access tokens are short-lived. We
 * store them as a {access_token, refresh_token, expires_at} bundle (see
 * claude-creds.ts) and refresh-before-use here, persisting the rotated token
 * back to the credential row. Mirrors how codex creds are handled.
 *
 * OAuth endpoints are the same ones pi-ai uses (the public Claude Code client):
 *   token URL: https://platform.claude.com/v1/oauth/token
 *   client_id: 9d1c250a-e61b-44d9-88ed-5944d1962f5e
 */

import { decrypt, encrypt } from "../crypto.js";
import { errMsg } from "./errors.js";
import { CONFIG } from "../config.js";
import { parseClaudeCred, type ClaudeOAuthBundle } from "./claude-creds.js";

export const CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const SKEW_MS = 5 * 60 * 1000;

/** Thrown when a Claude credential can't be made valid (expired + refresh failed,
 *  or expired with no refresh token). Callers should surface "reconnect needed"
 *  rather than silently falling back. */
export class ClaudeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeAuthError";
  }
}

export interface ClaudeCredRow {
  encryptedKey: string | null;
  iv: string | null;
  authTag: string | null;
  authType: string | null;
}

/** Re-encrypted bundle to persist back to the cred row. */
export type EncryptedCred = { encryptedKey: string; iv: string; authTag: string };

// One in-flight refresh per credential key, so an expiry-storm of concurrent
// runs triggers exactly one token refresh instead of N.
const inflight = new Map<string, Promise<string>>();

/**
 * Return a valid Claude bearer token, refreshing + re-persisting when expired.
 *
 * @param credKey  stable dedupe key for this credential (e.g. `user:<id>:claude`).
 * @param cred     the stored credential row (encrypted).
 * @param persist  writes the rotated, re-encrypted bundle back to the row.
 */
export async function getValidClaudeBearer(
  credKey: string,
  cred: ClaudeCredRow,
  persist: (enc: EncryptedCred) => Promise<void>,
): Promise<string> {
  if (!cred.encryptedKey || !cred.iv || !cred.authTag) {
    throw new ClaudeAuthError("Claude credential is missing");
  }
  const bundle = parseClaudeCred(decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey));

  // Not an OAuth token, or a legacy/oauth bundle with no refresh token → use
  // as-is (it'll work until it expires; a reconnect upgrades it to refreshable).
  if (cred.authType !== "oauth_token") return bundle.access_token;
  if (!bundle.refresh_token) return bundle.access_token;
  // Still valid (with skew) → use it.
  if (bundle.expires_at && Date.now() < bundle.expires_at - SKEW_MS) return bundle.access_token;

  const existing = inflight.get(credKey);
  if (existing) return existing;

  const refreshToken = bundle.refresh_token;
  const p = (async () => {
    let res: Response;
    try {
      res = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: CLAUDE_OAUTH_CLIENT_ID,
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new ClaudeAuthError(`Claude token refresh request failed: ${errMsg(err)}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ClaudeAuthError(`Claude token refresh failed ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!data.access_token) throw new ClaudeAuthError("Claude token refresh returned no access_token");

    const next: ClaudeOAuthBundle = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? refreshToken,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000 - SKEW_MS,
    };
    const enc = encrypt(JSON.stringify(next), CONFIG.encryptionKey);
    await persist({ encryptedKey: enc.ciphertext, iv: enc.iv, authTag: enc.authTag });
    return next.access_token;
  })().finally(() => {
    inflight.delete(credKey);
  });

  inflight.set(credKey, p);
  return p;
}
