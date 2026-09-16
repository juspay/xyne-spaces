/**
 * Environment-based key-ring configuration for the backend
 * encryption service.
 *
 * ENCRYPTION_KEY in .env.local always remains the legacy key.
 * ENCRYPTION_KEYS (also in .env.local) is optional:
 *
 *   ENCRYPTION_KEYS=[{"id":"k1","key":"..."},{"id":"k2","key":"..."}]
 *
 * A valid, non-empty array activates key-ring mode: the last array
 * entry is the active writer and every entry can decrypt. When the
 * variable is missing, blank, or invalid, the service falls back to
 * legacy-only mode and emits one sanitized log line — key material
 * is never logged and startup never fails because of this variable.
 */

import { logger } from '@/utils/logger';
import {
  EncryptionKeyRingConfigError,
  parseEncryptionKeyRing,
} from '@xyne/shared/server/encryption-key-ring';

export type EncryptionMode =
  | 'legacy'
  | 'keyring';

export type EncryptionModeReason =
  | 'keyring_not_configured'
  | 'keyring_json_invalid'
  | 'keyring_validation_failed'
  | 'keyring_enabled';

export interface EncryptionRuntimeConfig {
  mode: EncryptionMode;
  reason: EncryptionModeReason;
  keys: ReadonlyMap<string, Buffer>;
  activeKeyId: string | null;
}

let cachedConfig: EncryptionRuntimeConfig | null = null;

export function loadEncryptionRuntimeConfig():
  EncryptionRuntimeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const rawKeys = process.env.ENCRYPTION_KEYS?.trim();

  if (!rawKeys) {
    cachedConfig = {
      mode: 'legacy',
      reason: 'keyring_not_configured',
      keys: new Map(),
      activeKeyId: null,
    };

    logger.info(
      '[EncryptionService] mode=legacy ' +
        'reason=keyring_not_configured'
    );

    return cachedConfig;
  }

  try {
    const {
      keys,
      activeKeyId,
    } = parseEncryptionKeyRing(rawKeys);

    cachedConfig = {
      mode: 'keyring',
      reason: 'keyring_enabled',
      keys,
      activeKeyId,
    };

    logger.info(
      `[EncryptionService] mode=keyring ` +
        `reason=keyring_enabled activeKeyId=${activeKeyId}`
    );

    return cachedConfig;
  } catch (error) {
    const reason: EncryptionModeReason =
      error instanceof EncryptionKeyRingConfigError
        ? error.reason
        : 'keyring_validation_failed';

    cachedConfig = {
      mode: 'legacy',
      reason,
      keys: new Map(),
      activeKeyId: null,
    };

    logger.warn(
      `[EncryptionService] mode=legacy reason=${reason}; ` +
        'invalid ENCRYPTION_KEYS ignored, ' +
        'falling back to ENCRYPTION_KEY'
    );

    return cachedConfig;
  }
}
