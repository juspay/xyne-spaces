/**
 * Codex credentials may be stored as either:
 *  - a bare API key string ("sk-…")            — when authType="api_key"
 *  - a JSON bundle {access_token, refresh_token, expires_at} — when authType="oauth_token"
 *
 * Consumers want the bare bearer string suitable for `Authorization: Bearer …`.
 */
export function extractCodexBearer(decrypted: string): string {
  const trimmed = decrypted.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const obj = JSON.parse(trimmed) as { access_token?: string };
    if (obj.access_token) return obj.access_token;
  } catch { /* fall through */ }
  return trimmed;
}
