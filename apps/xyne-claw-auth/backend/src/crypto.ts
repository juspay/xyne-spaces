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
// AES-256-CBC, format `${ivHex}:${ciphertextHex}` — see xyne-spaces
// backend/src/services/encryptionService.ts. This decrypts that format using
// SPACES_ENCRYPTION_KEY (Spaces' key, distinct from claw-auth's own). Throws
// on malformed input; callers treat a throw as "skip this row".
const SPACES_CBC_ALGO = "aes-256-cbc";

export function decryptSpacesCbc(blob: string, key: Buffer): string {
  const sep = blob.indexOf(":");
  if (sep < 0) throw new Error("decryptSpacesCbc: blob missing IV separator");
  const ivHex = blob.slice(0, sep);
  const ctHex = blob.slice(sep + 1);
  if (ivHex.length === 0 || ctHex.length === 0) {
    throw new Error("decryptSpacesCbc: empty IV or ciphertext");
  }
  const decipher = createDecipheriv(SPACES_CBC_ALGO, key, Buffer.from(ivHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
