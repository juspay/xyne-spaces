import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const HKDF_SALT = Buffer.from("xyne-claw-auth/hkdf-sha256/v1", "utf8");
const decryptionFallbacks = new Map<string, Buffer[]>();

export function derivePurposeKey(masterKey: Buffer, purpose: string): Buffer {
  if (masterKey.length !== 32) throw new Error("Master encryption key must be 32 bytes");
  if (!purpose.trim()) throw new Error("HKDF purpose must not be empty");
  return Buffer.from(hkdfSync("sha256", masterKey, HKDF_SALT, Buffer.from(purpose, "utf8"), 32));
}

/** Register a read-only legacy key used only when the primary GCM key fails. */
export function registerDecryptionFallback(primaryKey: Buffer, legacyKey: Buffer): void {
  const id = primaryKey.toString("base64");
  const existing = decryptionFallbacks.get(id) ?? [];
  if (!existing.some((candidate) => candidate.equals(legacyKey))) {
    decryptionFallbacks.set(id, [...existing, Buffer.from(legacyKey)]);
  }
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decrypt(ciphertext: string, iv: string, authTag: string, key: Buffer): string {
  const candidates = [key, ...(decryptionFallbacks.get(key.toString("base64")) ?? [])];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const decipher = createDecipheriv(ALGORITHM, candidate, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(authTag, "base64"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64")),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// Spaces encrypts DB-stored secrets (e.g. installed_apps.signingSecret) with
// AES-256-CBC — see xyne-spaces backend/src/services/encryptionService.ts. It
// writes two formats, and this reader must understand both for as long as any
// row is on the older one:
//
//   `${ivHex}:${ctHex}`                  legacy, decrypted under keyId "legacy"
//   `v2:${keyId}:${ivHex}:${ctHex}`      versioned, decrypted under that keyId
//
// The key ids must agree with Spaces because the id travels in the ciphertext;
// the constants below are the same two values that service uses. CBC carries no
// authentication tag, so a wrong key does not reliably fail — that is precisely
// why the id is read rather than guessed, and why an unknown id throws instead
// of falling back to another key.
//
// Throws on malformed input; callers treat a throw as "skip this row".
const SPACES_CBC_ALGO = "aes-256-cbc";
const SPACES_VERSION_TAG = "v2";
const SPACES_LEGACY_KEY_ID = "legacy";

export type SpacesKeyRing = ReadonlyMap<string, Buffer>;

export function decryptSpacesCbc(blob: string, keys: SpacesKeyRing): string {
  const parts = blob.split(":");

  let keyId: string;
  let ivHex: string;
  let ctHex: string;

  if (parts.length === 4 && parts[0] === SPACES_VERSION_TAG) {
    [, keyId, ivHex, ctHex] = parts as [string, string, string, string];
  } else if (parts.length === 2) {
    keyId = SPACES_LEGACY_KEY_ID;
    [ivHex, ctHex] = parts as [string, string];
  } else {
    throw new Error(
      'decryptSpacesCbc: expected "iv:ct" or "v2:keyId:iv:ct"',
    );
  }

  if (ivHex.length === 0 || ctHex.length === 0) {
    throw new Error("decryptSpacesCbc: empty IV or ciphertext");
  }

  const key = keys.get(keyId);
  if (!key) {
    // Either the ring is unconfigured, or Spaces has moved to a key this
    // service was never given. Both are operator errors and both are worth
    // naming, because the caller's "skip this row" turns a silent miss into a
    // backfill that reports success while migrating nothing.
    throw new Error(
      `decryptSpacesCbc: no Spaces key registered for keyId "${keyId}" — ` +
        "set SPACES_ENCRYPTION_KEY, or add the id to SPACES_ENCRYPTION_KEYS",
    );
  }

  const decipher = createDecipheriv(SPACES_CBC_ALGO, key, Buffer.from(ivHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
