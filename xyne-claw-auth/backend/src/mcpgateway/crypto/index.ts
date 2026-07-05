/**
 * MCP Gateway Crypto Utilities
 * Encryption and decryption for backend secrets
 */

import crypto from "node:crypto";
import { CONFIG } from "../../config.js";
import { ENCRYPTION } from "../config/index.js";
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
  const iv = crypto.randomBytes(ENCRYPTION.IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION.ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedSecret: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/**
 * Decrypt a secret using AES-256-GCM
 */
export function decryptSecret(payload: EncryptedSecretPayload): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ENCRYPTION.ALGORITHM,
    key,
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedSecret, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

