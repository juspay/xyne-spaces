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
