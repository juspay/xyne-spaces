/**
 * Environment-based key-ring configuration for reading Spaces
 * ciphertext.
 *
 * SPACES_ENCRYPTION_KEY in .env always remains the legacy reader
 * for the backend's `iv:ciphertext` format.
 * SPACES_ENCRYPTION_KEYS (also in .env) is optional:
 *
 *   SPACES_ENCRYPTION_KEYS=[{"id":"k1","key":"..."},{"id":"k2","key":"..."}]
 *
 * A valid, non-empty array enables reading the backend's
 * `v2:keyId:iv:ciphertext` format — matched by key ID. Claw-auth
 * never writes Spaces ciphertext, so no active-key setting exists
 * here. When the variable is missing, blank, or malformed, the
 * service falls back to legacy-only mode and emits one sanitized
 * log line — key material is never logged and startup never fails
 * because of this variable.
 */

import { createLogger } from "./logger.js";
import {
  EncryptionKeyRingConfigError,
  parseEncryptionKeyRing,
} from "@xyne/shared/server/encryption-key-ring";

const log = createLogger(
  "spaces-encryption-key-ring-config",
);

export type SpacesEncryptionMode =
  | "legacy"
  | "keyring-read";

export type SpacesEncryptionModeReason =
  | "keyring_not_configured"
  | "keyring_json_invalid"
  | "keyring_validation_failed"
  | "keyring_read_enabled";

export interface SpacesEncryptionRuntimeConfig {
  mode: SpacesEncryptionMode;
  reason: SpacesEncryptionModeReason;
  keys: ReadonlyMap<string, Buffer>;
}

let cachedConfig:
  SpacesEncryptionRuntimeConfig | null = null;

export function loadSpacesEncryptionRuntimeConfig():
  SpacesEncryptionRuntimeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const rawKeys =
    process.env["SPACES_ENCRYPTION_KEYS"]?.trim();

  if (!rawKeys) {
    cachedConfig = {
      mode: "legacy",
      reason: "keyring_not_configured",
      keys: new Map(),
    };

    log.info(
      "mode=legacy reason=keyring_not_configured",
    );

    return cachedConfig;
  }

  try {
    const { keys } =
      parseEncryptionKeyRing(rawKeys);

    cachedConfig = {
      mode: "keyring-read",
      reason: "keyring_read_enabled",
      keys,
    };

    log.info("mode=keyring-read reason=keyring_read_enabled");

    return cachedConfig;
  } catch (error) {
    const reason: SpacesEncryptionModeReason =
      error instanceof EncryptionKeyRingConfigError
        ? error.reason
        : "keyring_validation_failed";

    cachedConfig = {
      mode: "legacy",
      reason,
      keys: new Map(),
    };

    log.warn(
      `mode=legacy reason=${reason}; ` +
        "invalid SPACES_ENCRYPTION_KEYS ignored, " +
        "falling back to SPACES_ENCRYPTION_KEY",
    );

    return cachedConfig;
  }
}
