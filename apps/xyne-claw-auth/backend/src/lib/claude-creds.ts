/**
 * Anthropic (Claude) credentials may be stored as either:
 *  - a bare API key / access-token string         — when authType="api_key", or
 *    legacy pasted OAuth access tokens (no refresh)
 *  - a JSON bundle {access_token, refresh_token, expires_at} — the refreshable
 *    OAuth shape (mirrors codex-creds.ts), written by the Claude OAuth flow.
 *
 * Consumers want the bare bearer string for `Authorization: Bearer …`.
 */

export interface ClaudeOAuthBundle {
  access_token: string;
  refresh_token?: string;
  /** epoch ms when the access_token expires (already skew-adjusted at write). */
  expires_at?: number;
}

export function parseClaudeCred(decrypted: string): ClaudeOAuthBundle {
  const trimmed = decrypted.trim();
  if (!trimmed.startsWith("{")) return { access_token: trimmed };
  try {
    const obj = JSON.parse(trimmed) as ClaudeOAuthBundle;
    if (obj.access_token) return obj;
  } catch {
    /* fall through to bare-string */
  }
  return { access_token: trimmed };
}

export function extractClaudeBearer(decrypted: string): string {
  return parseClaudeCred(decrypted).access_token;
}
