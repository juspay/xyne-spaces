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
