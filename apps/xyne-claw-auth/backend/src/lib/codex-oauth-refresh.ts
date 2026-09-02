/**
 * OpenAI Codex (ChatGPT) OAuth access-token refresh.
 *
 * Codex OAuth access tokens are short-lived. The connect flow stores a
 * {access_token, refresh_token, expires_at} bundle (see codex-creds.ts), but
 * nothing was refreshing it before use — so always-on codex agents 401'd with
 * "authentication token is expired" once the access token aged out and stayed
 * dead until a manual reconnect. This refreshes-before-use and persists the
 * rotated bundle back to the credential row. Mirrors getValidClaudeBearer.
 *
 * Endpoints + client_id match the Codex CLI / settings.ts connect flow:
 *   token URL: https://auth.openai.com/oauth/token   (form-encoded)
 *   client_id: app_EMoamEEZ73f0CkXaXp7hrann
 */

import { decrypt, encrypt } from "../crypto.js";
import { errMsg } from "./errors.js";
import { CONFIG } from "../config.js";
import { parseCodexCred, type CodexOAuthBundle } from "./codex-creds.js";

export const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const SKEW_MS = 5 * 60 * 1000;

/** Thrown when a codex credential can't be made valid (expired + refresh failed,
 *  or expired with no refresh token). Callers should surface "reconnect needed"
 *  rather than silently falling back. */
export class CodexAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAuthError";
  }
}

export interface CodexCredRow {
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
 * Return a valid Codex bearer token, refreshing + re-persisting when expired.
 *
 * @param credKey  stable dedupe key for this credential (e.g. `agent:<id>:codex`).
 * @param cred     the stored credential row (encrypted).
 * @param persist  writes the rotated, re-encrypted bundle back to the row.
 */
export async function getValidCodexBearer(
  credKey: string,
  cred: CodexCredRow,
  persist: (enc: EncryptedCred) => Promise<void>,
): Promise<string> {
  if (!cred.encryptedKey || !cred.iv || !cred.authTag) {
    throw new CodexAuthError("Codex credential is missing");
  }
  const bundle = parseCodexCred(decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey));

  // Not an OAuth token, or a bundle with no refresh token → use as-is (it'll
  // work until it expires; a reconnect upgrades it to refreshable).
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
      res = await fetch(CODEX_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CODEX_OAUTH_CLIENT_ID,
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new CodexAuthError(`Codex token refresh request failed: ${errMsg(err)}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CodexAuthError(`Codex token refresh failed ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!data.access_token) throw new CodexAuthError("Codex token refresh returned no access_token");

    const next: CodexOAuthBundle = {
      access_token: data.access_token,
      // OpenAI may or may not rotate the refresh token; keep the old one if absent.
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
