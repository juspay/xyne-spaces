/**
 * Codex credentials may be stored as either:
 *  - a bare API key string ("sk-…")            — when authType="api_key"
 *  - a JSON bundle {access_token, refresh_token, expires_at} — when authType="oauth_token"
 *
 * Consumers want the bare bearer string suitable for `Authorization: Bearer …`.
 */

export interface CodexOAuthBundle {
  access_token: string;
  refresh_token?: string;
  /** epoch ms when the access_token expires (already skew-adjusted at write). */
  expires_at?: number;
}

/** Parse the stored cred into a bundle. Bare-string creds become { access_token }. */
export function parseCodexCred(decrypted: string): CodexOAuthBundle {
  const trimmed = decrypted.trim();
  if (!trimmed.startsWith("{")) return { access_token: trimmed };
  try {
    const obj = JSON.parse(trimmed) as CodexOAuthBundle;
    if (obj.access_token) return obj;
  } catch {
    /* fall through to bare-string */
  }
  return { access_token: trimmed };
}

export function extractCodexBearer(decrypted: string): string {
  return parseCodexCred(decrypted).access_token;
}
