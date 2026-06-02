import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

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
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
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

