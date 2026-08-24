/**
 * Rotation-aware AES-256-CBC encryption service.
 *
 * Legacy ciphertext:
 *   iv:ciphertext
 *
 * Versioned ciphertext:
 *   v2:keyId:iv:ciphertext
 *
 * ENCRYPTION_KEY stores the legacy key.
 *
 * ENCRYPTION_KEYS is an ordered JSON array:
 *   [{"id":"k1","key":"64-hex"},{"id":"k2","key":"64-hex"}]
 *
 * The final array entry is the active writer. All entries remain available
 * for decryption. If the array is absent or empty, writes remain legacy.
 *
 * To preload a future key without activating it, place it before the current
 * final entry. Move it to the end only after every reader has received it.
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
function parseHexKey(
  raw: unknown,
  label: string
): Buffer {
  if (typeof raw !== 'string') {
    throw new Error(
      `${label} must be 32 bytes (64 hex characters)`
    );
  }

  const normalized = raw.trim();

  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(
      `${label} must be 32 bytes (64 hex characters)`
    );
  }

  return Buffer.from(normalized, 'hex');
}

function parseOrderedKeys(raw: string): Array<{ id: string; key: string }> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'ENCRYPTION_KEYS must be an ordered JSON array ' + 'of objects with id and key fields'
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      'ENCRYPTION_KEYS must be an ordered JSON array ' + 'of objects with id and key fields'
    );
  }

  const seen = new Set<string>();

  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('ENCRYPTION_KEYS[' + index + '] must be an object');
    }

    const entry = value as {
      id?: unknown;
      key?: unknown;
    };

    if (typeof entry.id !== 'string') {
      throw new Error('ENCRYPTION_KEYS[' + index + '].id must be a string');
    }

    const id = entry.id.trim();

    if (!id || id !== entry.id || id.includes(':') || id === VERSION_TAG || id === LEGACY_KEY_ID) {
      throw new Error('Invalid key id at ENCRYPTION_KEYS[' + index + ']');
    }

    if (seen.has(id)) {
      throw new Error('Duplicate encryption key id "' + id + '"');
    }

    seen.add(id);

    parseHexKey(entry.key, 'ENCRYPTION_KEYS[' + index + '].key');

    return {
      id,
      key: entry.key as string,
    };
  });
}

/**
 * Build (and cache) the key ring from the environment. The env is read once per
 * process; tests can force a rebuild with _resetKeyRingCache().
 */
function loadKeyRing(): KeyRing {
  if (cachedRing) {
    return cachedRing;
  }

  const keys = new Map<string, Buffer>();

  const legacy = process.env.ENCRYPTION_KEY;

  if (legacy) {
    keys.set(LEGACY_KEY_ID, parseHexKey(legacy, 'ENCRYPTION_KEY'));
  }

  const configured = process.env.ENCRYPTION_KEYS;

  const orderedKeys = configured && configured.trim() ? parseOrderedKeys(configured) : [];

  for (const entry of orderedKeys) {
    keys.set(entry.id, parseHexKey(entry.key, 'ENCRYPTION_KEYS key "' + entry.id + '"'));
  }

  const activeKeyId = orderedKeys.length > 0 ? orderedKeys[orderedKeys.length - 1].id : null;

  cachedRing = {
    keys,
    activeKeyId,
  };

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
        : `No encryption key registered for keyId "${keyId}"`
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
 * Return the ID of the current write key.
 *
 * ENCRYPTION_KEYS is ordered, so the final entry is the active writer.
 * Returns null when the ordered ring is absent or empty and writes remain
 * on the legacy ENCRYPTION_KEY format.
 */
export function getActiveEncryptionKeyId(): string | null {
  return loadKeyRing().activeKeyId;
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
      'Invalid encrypted data format. Expected "IV:ciphertext" or "v2:keyId:IV:ciphertext"'
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
