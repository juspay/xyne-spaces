/**
 * Environment-based key-ring configuration for the backend
 * encryption service.
 *
 * Everything below lives in the service's existing .env.local;
 * no separate key-ring file exists. Any change to these values is
 * read once per process and requires a restart. API replicas,
 * workers and command-line jobs must all receive the same ring.
 *
 *   ENCRYPTION_KEY             original legacy key (always kept)
 *   ENCRYPTION_KEYS            optional JSON ring, every entry can
 *                              decrypt `v2` ciphertext
 *   ENCRYPTION_ACTIVE_KEY_ID   optional ring ID used for new writes
 *
 * Modes:
 *   legacy        no/invalid ENCRYPTION_KEYS — legacy writes and reads
 *   keyring-read  valid ring, no usable active ID — legacy writes,
 *                 legacy + v2 reads; deploy this to every reader
 *                 process BEFORE activating writes anywhere
 *   keyring-write valid ring + ENCRYPTION_ACTIVE_KEY_ID found in the
 *                 ring — v2 writes with the active key
 *
 * Invalid optional configuration never stops startup: the service
 * falls back to the safest applicable mode and emits exactly one
 * sanitized log line (mode + reason code only — key material is
 * never logged).
 */

import { logger } from '@/utils/logger';
import {
  EncryptionKeyRingConfigError,
  parseEncryptionKeyRing,
} from '@xyne/shared/server/encryption-key-ring';

export type EncryptionMode =
  | 'legacy'
  | 'keyring-read'
  | 'keyring-write';

export type EncryptionModeReason =
  | 'keyring_not_configured'
  | 'keyring_json_invalid'
  | 'keyring_validation_failed'
  | 'active_key_not_configured'
  | 'active_key_not_found'
  | 'keyring_write_enabled';

export interface EncryptionRuntimeConfig {
  mode: EncryptionMode;
  reason: EncryptionModeReason;
  keys: ReadonlyMap<string, Buffer>;
  activeKeyId: string | null;
}

let cachedConfig: EncryptionRuntimeConfig | null = null;

function selected(
  config: EncryptionRuntimeConfig,
  level: 'info' | 'warn'
): EncryptionRuntimeConfig {
  logger[level](
    `[EncryptionService] mode=${config.mode} ` +
      `reason=${config.reason}` +
      (config.activeKeyId
        ? ` activeKeyId=${config.activeKeyId}`
        : '')
  );

  return config;
}

export function loadEncryptionRuntimeConfig():
  EncryptionRuntimeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const rawKeys = process.env.ENCRYPTION_KEYS?.trim();

  if (!rawKeys) {
    cachedConfig = selected(
      {
        mode: 'legacy',
        reason: 'keyring_not_configured',
        keys: new Map(),
        activeKeyId: null,
      },
      'info'
    );

    return cachedConfig;
  }

  let keys: ReadonlyMap<string, Buffer>;

  try {
    keys = parseEncryptionKeyRing(rawKeys).keys;
  } catch (error) {
    const reason: EncryptionModeReason =
      error instanceof EncryptionKeyRingConfigError
        ? error.reason
        : 'keyring_validation_failed';

    cachedConfig = selected(
      {
        mode: 'legacy',
        reason,
        keys: new Map(),
        activeKeyId: null,
      },
      'warn'
    );

    return cachedConfig;
  }

  const rawActiveKeyId =
    process.env.ENCRYPTION_ACTIVE_KEY_ID?.trim();

  if (!rawActiveKeyId) {
    cachedConfig = selected(
      {
        mode: 'keyring-read',
        reason: 'active_key_not_configured',
        keys,
        activeKeyId: null,
      },
      'info'
    );

    return cachedConfig;
  }

  if (!keys.has(rawActiveKeyId)) {
    cachedConfig = selected(
      {
        mode: 'keyring-read',
        reason: 'active_key_not_found',
        keys,
        activeKeyId: null,
      },
      'warn'
    );

    return cachedConfig;
  }

  cachedConfig = selected(
    {
      mode: 'keyring-write',
      reason: 'keyring_write_enabled',
      keys,
      activeKeyId: rawActiveKeyId,
    },
    'info'
  );

  return cachedConfig;
}
