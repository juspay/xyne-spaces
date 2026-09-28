/**
 * Backward-compatible AES-256-CBC encryption service.
 *
 * Mode selection and the key-ring parser both live in this file:
 *   legacy        original behavior, writes `iv:ciphertext`
 *   keyring-read  still writes `iv:ciphertext`, additionally
 *                 reads `v2:keyId:iv:ciphertext`
 *   keyring-write writes `v2:keyId:iv:ciphertext` with the
 *                 configured ENCRYPTION_ACTIVE_KEY_ID, reads both
 *                 formats
 *
 * Key-ring configuration comes from ENCRYPTION_KEYS (JSON) and
 * ENCRYPTION_ACTIVE_KEY_ID; the parser is shared with claw-auth via
 * @xyne/shared/server/encryption-key-ring.
 */

import crypto from 'crypto';
import { logger } from '@/utils/logger';
import {
  EncryptionKeyRingConfigError,
  parseEncryptionKeyRing,
} from '@xyne/shared/server/encryption-key-ring';

export type EncryptionMode = 'legacy' | 'keyring-read' | 'keyring-write';

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

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const VERSION_TAG = 'v2';

let cachedConfig: EncryptionRuntimeConfig | null = null;

function selected(
  config: EncryptionRuntimeConfig,
  level: 'info' | 'warn'
): EncryptionRuntimeConfig {
  logger[level](
    `[EncryptionService] mode=${config.mode} ` +
      `reason=${config.reason}` +
      (config.activeKeyId ? ` activeKeyId=${config.activeKeyId}` : '')
  );

  return config;
}

export function loadEncryptionRuntimeConfig(): EncryptionRuntimeConfig {
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

  const rawActiveKeyId = process.env.ENCRYPTION_ACTIVE_KEY_ID?.trim();

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

class EncryptionServiceError extends Error {
  constructor(
    readonly reasonCode: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Original pre-rotation key loading behavior.
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY not found in environment variables'
    );
  }

  const keyBuffer = Buffer.from(key, 'hex');

  if (keyBuffer.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must be 32 bytes (64 hex characters)'
    );
  }

  return keyBuffer;
}

/**
 * Original pre-rotation encryption implementation.
 */
function encryptLegacy(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(
    ALGORITHM,
    key,
    iv
  );

  let encrypted = cipher.update(
    plaintext,
    'utf8',
    'hex'
  );

  encrypted += cipher.final('hex');

  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Original pre-rotation decryption implementation.
 */
function decryptLegacy(
  encryptedData: string
): string {
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');

  if (parts.length !== 2) {
    throw new Error(
      'Invalid encrypted data format. ' +
        'Expected "IV:ciphertext"'
    );
  }

  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  if (iv.length !== IV_LENGTH) {
    throw new Error(
      `Invalid IV length. Expected ${IV_LENGTH} bytes`
    );
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    iv
  );

  let decrypted = decipher.update(
    encrypted,
    'hex',
    'utf8'
  );

  decrypted += decipher.final('utf8');

  return decrypted;
}

function encryptVersioned(
  plaintext: string,
  config: EncryptionRuntimeConfig
): string {
  const keyId = config.activeKeyId;

  if (!keyId) {
    throw new EncryptionServiceError(
      'active_key_missing',
      'No active encryption key is configured'
    );
  }

  const key = config.keys.get(keyId);

  if (!key) {
    throw new EncryptionServiceError(
      'active_key_missing',
      'The active encryption key is unavailable'
    );
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    key,
    iv
  );

  let encrypted = cipher.update(
    plaintext,
    'utf8',
    'hex'
  );

  encrypted += cipher.final('hex');

  return (
    `${VERSION_TAG}:${keyId}:` +
    `${iv.toString('hex')}:${encrypted}`
  );
}

function decryptVersioned(
  encryptedData: string,
  config: EncryptionRuntimeConfig
): string {
  if (config.mode === 'legacy') {
    throw new EncryptionServiceError(
      'keyring_unavailable',
      'Versioned encrypted data requires ' +
        'a valid ENCRYPTION_KEYS configuration'
    );
  }

  const parts = encryptedData.split(':');

  if (
    parts.length !== 4 ||
    parts[0] !== VERSION_TAG ||
    !parts[1] ||
    !parts[2] ||
    !parts[3]
  ) {
    throw new EncryptionServiceError(
      'invalid_encrypted_data_format',
      'Invalid versioned encrypted data format'
    );
  }

  const keyId = parts[1];
  const key = config.keys.get(keyId);

  if (!key) {
    throw new EncryptionServiceError(
      'versioned_key_not_found',
      `No encryption key is registered for "${keyId}"`
    );
  }

  const iv = Buffer.from(parts[2], 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new EncryptionServiceError(
      'invalid_iv_length',
      `Invalid IV length. Expected ${IV_LENGTH} bytes`
    );
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    iv
  );

  let plaintext = decipher.update(
    parts[3],
    'hex',
    'utf8'
  );

  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Encrypt using the original legacy format unless key-ring
 * write mode is active (valid ENCRYPTION_KEYS plus a matching
 * ENCRYPTION_ACTIVE_KEY_ID). In key-ring read mode writes stay
 * legacy so every reader can be deployed before any V2 data
 * exists.
 */
export function encrypt(plaintext: string): string {
  const config = loadEncryptionRuntimeConfig();

  if (config.mode !== 'keyring-write') {
    return encryptLegacy(plaintext);
  }

  return encryptVersioned(plaintext, config);
}

/**
 * Read the original format in every mode. Versioned data is
 * accepted only while a valid key ring is configured.
 */
export function decrypt(
  encryptedData: string
): string {
  const isVersioned =
    encryptedData.startsWith(`${VERSION_TAG}:`);

  if (!isVersioned) {
    return decryptLegacy(encryptedData);
  }

  const config = loadEncryptionRuntimeConfig();

  return decryptVersioned(encryptedData, config);
}
