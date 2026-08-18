/**
 * MCP Gateway Crypto Utilities
 * Encryption and decryption for backend secrets
 */

import { CONFIG } from "../../config.js";
import { decrypt, encrypt } from "../../crypto.js";
import type { EncryptedSecretPayload } from "../types/index.js";

/**
 * Get encryption key from config or environment
 */
function getEncryptionKey(): Buffer {
  const keyFromConfig = CONFIG.encryptionKey;
  if (keyFromConfig && keyFromConfig.length === 32) {
    return keyFromConfig;
  }

  const envKey =
    process.env.BACKEND_CLIENT_SECRET_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY;

  if (!envKey) {
    throw new Error(
      "Missing encryption key: set BACKEND_CLIENT_SECRET_ENCRYPTION_KEY or ENCRYPTION_KEY"
    );
  }

  // Try hex (64-char hex string = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
    return Buffer.from(envKey, "hex");
  }

  // Try base64
  const base64Key = Buffer.from(envKey, "base64");
  if (base64Key.length === 32) {
    return base64Key;
  }

  // Try raw utf8
  const utf8Key = Buffer.from(envKey, "utf8");
  if (utf8Key.length === 32) {
    return utf8Key;
  }

  throw new Error(
    "Encryption key must be a 32-byte value (hex, base64, or utf8)"
  );
}

/**
 * Encrypt a secret using AES-256-GCM
 */
export function encryptSecret(secret: string): EncryptedSecretPayload {
  const key = getEncryptionKey();
  const encrypted = encrypt(secret, key);

  return {
    encryptedSecret: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  };
}

/**
 * Decrypt a secret using AES-256-GCM
 */
export function decryptSecret(payload: EncryptedSecretPayload): string {
  return decrypt(payload.encryptedSecret, payload.iv, payload.authTag, getEncryptionKey());
}
