// Guard rails for IPC inputs from the renderer (which can run attacker
// controlled content). Validate at the main-process boundary.

const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  'https:',
  'http:',
  'mailto:',
  'x-apple.systempreferences:',
]);

// https-only URL for shell.openExternal. Returns trimmed url or null.
export function normalizeExternalUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(trimmed);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase()) ? trimmed : null;
  } catch {
    return null;
  }
}

// Lowercase hex token from crypto.randomBytes(byteSize).toString('hex').
const HEX_CHARS = /^[a-f0-9]+$/;

export function isHexToken(value: unknown, byteSize: number): value is string {
  if (typeof value !== 'string') return false;
  return value.length === byteSize * 2 && HEX_CHARS.test(value);
}

/**
 * A call has one invite URL — `{EXTERNAL_CALL_INVITE_BASE_URL}/call/<externalId>`
 * — so a host can share the same link with teammates and with guests. It points
 * at the external lobby app, so the ordinary link rules would either replace the
 * app window with the guest lobby or push a workspace member out into a browser
 * panel, making them walk through the lobby just to be redirected back in.
 *
 * Spaces hosts the call itself at `/call/<id>`, so main forwards these to the
 * renderer's router over 'navigate-to' — the same channel deep links and
 * notifications already use. The `/external/call/<id>` path shape is ours and
 * nobody else's, which keeps this independent of the host a deployment uses.
 *
 * Returns the in-app path to navigate to, or null when the URL is not an invite.
 */
export function callInvitePath(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'external' || segments[1] !== 'call' || !segments[2]) {
      return null;
    }
    return `/call/${encodeURIComponent(segments[2])}`;
  } catch {
    return null;
  }
}
// ---------------------------------------------------------------------------
// Deep-link ask-ai parameter validation (PY-JP-019)
//
// A xyne-spaces://ask-ai deep link is externally triggerable (any web page can
// set location.href). Its text/url/domain/title query params are forwarded
// verbatim to the privileged renderer via the open-xyne-ai-with-context IPC and
// end up in an AI prompt / DOM. Validate and sanitize each param at the main
// process boundary before forwarding; callers should drop values that fail.
// ---------------------------------------------------------------------------

// Free-text params (ask-ai text/title). Strip control chars (including the
// prompt-structure-breaking ones), collapse runs of whitespace, and cap length.
// Never throws — returns a safe string ('' if input is unusable).
export function sanitizeAskAiText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, " ") // control chars
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

// URL param: parse with URL() and accept only http(s). Rejects javascript:,
// data:, file:, protocol-relative, and malformed input. Returns the normalized
// href, or '' when invalid.
export function normalizeAskAiUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return '';
  try {
    const parsed = new URL(value.trim());
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'https:' && protocol !== 'http:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

// Hostname pattern (RFC-1123 labels, max 253 chars). Returns the lowercased
// domain, or '' when it does not look like a hostname.
const HOSTNAME_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME_RE = new RegExp(`^${HOSTNAME_LABEL}(?:\\.${HOSTNAME_LABEL})*$`, 'i');

export function normalizeAskAiDomain(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 253) return '';
  return HOSTNAME_RE.test(trimmed) ? trimmed : '';
}
