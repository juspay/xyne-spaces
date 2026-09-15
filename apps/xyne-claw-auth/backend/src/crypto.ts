import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from "node:crypto";
import {
  loadSpacesEncryptionRuntimeConfig,
  writeSpacesEncryptionDiagnostic,
} from "./spaces-encryption-key-ring-config.js";

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
const SPACES_VERSION_TAG = "v2";
const SPACES_LEGACY_KEY_ID = "legacy";
const SPACES_CBC_IV_LENGTH = 16;

class SpacesCbcDecryptionError extends Error {
  constructor(
    readonly reasonCode: string,
    message: string,
  ) {
    super(message);
    this.name = "SpacesCbcDecryptionError";
  }
}

function decryptSpacesCbcPayload(
  ivHex: string,
  ciphertextHex: string,
  key: Buffer,
): string {
  const decipher = createDecipheriv(
    SPACES_CBC_ALGO,
    key,
    Buffer.from(ivHex, "hex"),
  );

  const decrypted = Buffer.concat([
    decipher.update(
      Buffer.from(ciphertextHex, "hex"),
    ),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function spacesDecryptionFailureReason(
  error: unknown,
): string {
  return error instanceof SpacesCbcDecryptionError
    ? error.reasonCode
    : "crypto_operation_failed";
}

/**
 * Decrypt a signing secret written by the Spaces backend.
 *
 * Legacy blobs continue using SPACES_ENCRYPTION_KEY from
 * Claw-auth's original .env file.
 *
 * Versioned blobs use the optional read-only key ring.
 */
export function decryptSpacesCbc(
  blob: string,
  legacyKey: Buffer,
  operation = "unspecified",
): string {
  const config =
    loadSpacesEncryptionRuntimeConfig();

  const startedAt = Date.now();
  const isVersioned = blob.startsWith(
    `${SPACES_VERSION_TAG}:`,
  );

  let keyId: string | null = isVersioned
    ? blob.split(":")[1] ?? null
    : SPACES_LEGACY_KEY_ID;

  try {
    if (!isVersioned) {
      const separator = blob.indexOf(":");

      if (separator < 0) {
        throw new Error(
          "decryptSpacesCbc: blob missing IV separator",
        );
      }

      const ivHex = blob.slice(0, separator);
      const ciphertextHex = blob.slice(
        separator + 1,
      );

      if (
        ivHex.length === 0 ||
        ciphertextHex.length === 0
      ) {
        throw new Error(
          "decryptSpacesCbc: empty IV or ciphertext",
        );
      }

      const plaintext = decryptSpacesCbcPayload(
        ivHex,
        ciphertextHex,
        legacyKey,
      );

      writeSpacesEncryptionDiagnostic(
        config,
        {
          event: "decrypt",
          operation,
          format: "legacy",
          keyId,
          success: true,
          durationMs: Date.now() - startedAt,
        },
      );

      return plaintext;
    }

    if (config.mode === "legacy") {
      throw new SpacesCbcDecryptionError(
        "keyring_unavailable",
        "Versioned Spaces data requires a valid .env.keyring",
      );
    }

    const [
      version,
      versionedKeyId,
      ivHex,
      ciphertextHex,
    ] = blob.split(":");

    if (
      version !== SPACES_VERSION_TAG ||
      !versionedKeyId ||
      !ivHex ||
      !ciphertextHex
    ) {
      throw new SpacesCbcDecryptionError(
        "invalid_encrypted_data_format",
        "Invalid versioned Spaces ciphertext",
      );
    }

    const parts = blob.split(":");

    if (parts.length !== 4) {
      throw new SpacesCbcDecryptionError(
        "invalid_encrypted_data_format",
        "Invalid versioned Spaces ciphertext",
      );
    }

    keyId = versionedKeyId;

    const key = config.keys.get(
      versionedKeyId,
    );

    if (!key) {
      throw new SpacesCbcDecryptionError(
        "versioned_key_not_found",
        `No Spaces encryption key is registered for "${versionedKeyId}"`,
      );
    }

    const iv = Buffer.from(ivHex, "hex");

    if (iv.length !== SPACES_CBC_IV_LENGTH) {
      throw new SpacesCbcDecryptionError(
        "invalid_iv_length",
        `Invalid IV length. Expected ${SPACES_CBC_IV_LENGTH} bytes`,
      );
    }

    const plaintext = decryptSpacesCbcPayload(
      ivHex,
      ciphertextHex,
      key,
    );

    writeSpacesEncryptionDiagnostic(
      config,
      {
        event: "decrypt",
        operation,
        format: "v2",
        keyId,
        success: true,
        durationMs: Date.now() - startedAt,
      },
    );

    return plaintext;
  } catch (error) {
    writeSpacesEncryptionDiagnostic(
      config,
      {
        event: "decrypt",
        operation,
        format: isVersioned
          ? "v2"
          : "legacy",
        keyId,
        success: false,
        durationMs: Date.now() - startedAt,
        reasonCode:
          spacesDecryptionFailureReason(error),
      },
    );

    throw error;
  }
}
