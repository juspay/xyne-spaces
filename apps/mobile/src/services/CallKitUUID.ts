import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';

const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is already a canonical 8-4-4-4-12 UUID string. */
export function isCanonicalUUID(value: string): boolean {
  return CANONICAL_UUID_RE.test(value.trim());
}

/**
 * CallKit UUID for a backend callId.
 *
 * Canonical UUIDs pass through lower-cased; anything else is hashed into a
 * version-5-shaped UUID. The native side (`LotusCallPushRouter.callKitUUID` in
 * plugins/withVoipPushIOS.cjs) applies the exact same rule, so JS can end a
 * ring that native reported while the JS runtime was dead — no shared state,
 * no native module, just the callId.
 */
export function deriveCallKitUUID(callId: string): string {
  const trimmed = callId.trim();
  if (isCanonicalUUID(trimmed)) {
    return trimmed.toLowerCase();
  }
  const bytes = sha256(utf8ToBytes(trimmed)).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Case-insensitive UUID equality — CallKit compares NSUUIDs, not strings. */
export function isSameCallKitUUID(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  return a.toLowerCase() === b.toLowerCase();
}
