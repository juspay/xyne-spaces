/**
 * Encryption Service
 * AES-256-CBC encryption/decryption for sensitive data.
 *
 * Rotation-aware: supports a versioned ciphertext format and a key ring so that
 * at-rest encryption keys (Class B) can be rotated without downtime.
 *
 *   Legacy format:    "<iv>:<ciphertext>"                (2 colon-parts)
 *   Versioned format: "v2:<keyId>:<iv>:<ciphertext>"     (4 colon-parts)
 *
 * decrypt() understands BOTH formats, so old rows keep decrypting while new
 * rows can be written under a new key. encrypt() only emits the versioned
 * format when a write key is explicitly activated via ENCRYPTION_ACTIVE_KEY_ID;
 * otherwise it emits the byte-for-byte legacy format keyed on ENCRYPTION_KEY,
 * so simply shipping this code changes nothing on disk.
 *
 * Rotation phases (see the Class B rotation strategy):
 *   Phase 0  Deploy this code to every consumer. No env change -> decrypt is
 *            key-aware everywhere, encrypt still emits legacy. Zero data change.
 *   Phase 1  Add the new key to ENCRYPTION_KEYS and set ENCRYPTION_ACTIVE_KEY_ID.
 *            New writes become "v2:<newKeyId>:..."; old rows still decrypt.
 *   Phase 2  Backfill re-encrypts every stored row under the active key.
 *   Phase 3  Drop the retired key from ENCRYPTION_KEYS once no row references it.
 *
 * Environment variables:
 *   ENCRYPTION_KEY             (existing) 64 hex chars. Always registered under
 *                              keyId "legacy" and used for legacy-format rows.
 *   ENCRYPTION_KEYS            (optional) JSON object { "<keyId>": "<64-hex>" }
 *                              of additional keys available for decryption and
 *                              as candidate write keys.
 *   ENCRYPTION_ACTIVE_KEY_ID   (optional) keyId to encrypt NEW data with. Must
 *                              exist in the ring. When unset, encrypt() stays on
 *                              the legacy format/key (no behavioural change).
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // AES block size
const VERSION_TAG = 'v2';
const LEGACY_KEY_ID = 'legacy';

interface KeyRing {
  keys: Map<string, Buffer>;
  activeKeyId: string | null;
}

let cachedRing: KeyRing | null = null;

/**
 * Parse a 32-byte (64 hex char) key. Rejects anything that is not AES-256 sized.
 */
function parseHexKey(raw: string, label: string): Buffer {
  const keyBuffer = Buffer.from(raw, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error(`${label} must be 32 bytes (64 hex characters)`);
  }
  return keyBuffer;
}

/**
 * Build (and cache) the key ring from the environment. The env is read once per
 * process; tests can force a rebuild with _resetKeyRingCache().
 */
function loadKeyRing(): KeyRing {
  if (cachedRing) return cachedRing;

  const keys = new Map<string, Buffer>();

  // The existing single key is always registered as "legacy" so every existing
  // ("<iv>:<ct>") row keeps decrypting unchanged.
  const legacy = process.env.ENCRYPTION_KEY;
  if (legacy) {
    keys.set(LEGACY_KEY_ID, parseHexKey(legacy, 'ENCRYPTION_KEY'));
  }

  // Additional named keys for rotation.
  const extra = process.env.ENCRYPTION_KEYS;
  if (extra && extra.trim()) {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(extra);
    } catch {
      throw new Error('ENCRYPTION_KEYS must be a JSON object of { "keyId": "hexKey" }');
    }
    for (const [keyId, hex] of Object.entries(parsed)) {
      if (!keyId || keyId === VERSION_TAG || keyId.includes(':')) {
        throw new Error(
          `Invalid keyId "${keyId}" in ENCRYPTION_KEYS (must be non-empty and contain no ':', and not equal "${VERSION_TAG}")`,
        );
      }
      keys.set(keyId, parseHexKey(hex, `ENCRYPTION_KEYS["${keyId}"]`));
    }
  }

  const activeKeyId = process.env.ENCRYPTION_ACTIVE_KEY_ID?.trim() || null;
  if (activeKeyId && !keys.has(activeKeyId)) {
    throw new Error(
      `ENCRYPTION_ACTIVE_KEY_ID="${activeKeyId}" is not present in the key ring. ` +
        `Register it in ENCRYPTION_KEYS, or set it to "${LEGACY_KEY_ID}" (ENCRYPTION_KEY).`,
    );
  }

  cachedRing = { keys, activeKeyId };
  return cachedRing;
}

/**
 * Resolve a key by id or throw a clear error. A throw here on decrypt means the
 * ciphertext references a key that has already been retired from the ring —
 * the Phase 3 safety net.
 */
function getKey(keyId: string): Buffer {
  const key = loadKeyRing().keys.get(keyId);
  if (!key) {
    throw new Error(
      keyId === LEGACY_KEY_ID
        ? 'ENCRYPTION_KEY not found in environment variables'
        : `No encryption key registered for keyId "${keyId}"`,
    );
  }
  return key;
}

/**
 * Clear the cached key ring. Intended for tests / hot config reloads only.
 */
export function _resetKeyRingCache(): void {
  cachedRing = null;
}

/**
 * Encrypt plaintext using AES-256-CBC.
 * Returns "v2:<keyId>:<iv>:<ciphertext>" when a write key is activated,
 * otherwise the legacy "<iv>:<ciphertext>" format (both hex).
 */
export function encrypt(plaintext: string): string {
  const ring = loadKeyRing();
  const writeKeyId = ring.activeKeyId ?? LEGACY_KEY_ID;
  const key = getKey(writeKeyId);

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  if (ring.activeKeyId) {
    return `${VERSION_TAG}:${writeKeyId}:${iv.toString('hex')}:${encrypted}`;
  }
  // Legacy format — byte-for-byte identical to the pre-rotation output.
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt ciphertext using AES-256-CBC.
 * Accepts both the versioned "v2:<keyId>:<iv>:<ct>" and the legacy "<iv>:<ct>"
 * formats. Legacy rows are decrypted with the "legacy" key (ENCRYPTION_KEY).
 */
export function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');

  let keyId: string;
  let ivHex: string;
  let ciphertextHex: string;

  if (parts.length === 4 && parts[0] === VERSION_TAG) {
    // Versioned: v2:<keyId>:<iv>:<ciphertext>
    keyId = parts[1];
    ivHex = parts[2];
    ciphertextHex = parts[3];
  } else if (parts.length === 2) {
    // Legacy: <iv>:<ciphertext>
    keyId = LEGACY_KEY_ID;
    ivHex = parts[0];
    ciphertextHex = parts[1];
  } else {
    throw new Error(
      'Invalid encrypted data format. Expected "IV:ciphertext" or "v2:keyId:IV:ciphertext"',
    );
  }

  const key = getKey(keyId);
  const iv = Buffer.from(ivHex, 'hex');
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length. Expected ${IV_LENGTH} bytes`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
