/**
 * Backward-compatible AES-256-CBC encryption service.
 *
 * Without a valid optional .env.keyring file, the original
 * encryption and decryption implementation is used.
 */

import crypto from 'crypto';
import {
  type EncryptionRuntimeConfig,
  loadEncryptionRuntimeConfig,
  writeEncryptionOperationDiagnostic,
} from './encryptionKeyRingConfig.js';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const VERSION_TAG = 'v2';
const LEGACY_KEY_ID = 'legacy';

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
): {
  encryptedData: string;
  keyId: string;
} {
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

  return {
    encryptedData:
      `${VERSION_TAG}:${keyId}:` +
      `${iv.toString('hex')}:${encrypted}`,
    keyId,
  };
}

function decryptVersioned(
  encryptedData: string,
  config: EncryptionRuntimeConfig
): {
  plaintext: string;
  keyId: string;
} {
  if (config.mode === 'legacy') {
    throw new EncryptionServiceError(
      'keyring_unavailable',
      'Versioned encrypted data requires ' +
        'a valid .env.keyring configuration'
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

  return {
    plaintext,
    keyId,
  };
}

function failureReason(error: unknown): string {
  return error instanceof EncryptionServiceError
    ? error.reasonCode
    : 'crypto_operation_failed';
}

/**
 * Encrypt using the original format unless a valid key ring
 * with an explicitly active key has been loaded.
 */
export function encrypt(plaintext: string): string {
  const config = loadEncryptionRuntimeConfig();
  const startedAt = Date.now();
  const useVersioned =
    config.mode === 'keyring-write';

  try {
    if (!useVersioned) {
      const encryptedData = encryptLegacy(plaintext);

      writeEncryptionOperationDiagnostic(
        config,
        {
          event: 'encrypt',
          format: 'legacy',
          keyId: LEGACY_KEY_ID,
          success: true,
          durationMs: Date.now() - startedAt,
        }
      );

      return encryptedData;
    }

    const result = encryptVersioned(
      plaintext,
      config
    );

    writeEncryptionOperationDiagnostic(
      config,
      {
        event: 'encrypt',
        format: 'v2',
        keyId: result.keyId,
        success: true,
        durationMs: Date.now() - startedAt,
      }
    );

    return result.encryptedData;
  } catch (error) {
    writeEncryptionOperationDiagnostic(
      config,
      {
        event: 'encrypt',
        format: useVersioned
          ? 'v2'
          : 'legacy',
        keyId: useVersioned
          ? config.activeKeyId
          : LEGACY_KEY_ID,
        success: false,
        durationMs: Date.now() - startedAt,
        reasonCode: failureReason(error),
      }
    );

    throw error;
  }
}

/**
 * Read the original format in every mode. Versioned data is
 * accepted only while a valid key-ring file is available.
 */
export function decrypt(
  encryptedData: string
): string {
  const config = loadEncryptionRuntimeConfig();
  const startedAt = Date.now();
  const isVersioned =
    encryptedData.startsWith(`${VERSION_TAG}:`);

  let keyId: string | null = isVersioned
    ? encryptedData.split(':')[1] || null
    : LEGACY_KEY_ID;

  try {
    if (!isVersioned) {
      const plaintext = decryptLegacy(
        encryptedData
      );

      writeEncryptionOperationDiagnostic(
        config,
        {
          event: 'decrypt',
          format: 'legacy',
          keyId,
          success: true,
          durationMs: Date.now() - startedAt,
        }
      );

      return plaintext;
    }

    const result = decryptVersioned(
      encryptedData,
      config
    );

    keyId = result.keyId;

    writeEncryptionOperationDiagnostic(
      config,
      {
        event: 'decrypt',
        format: 'v2',
        keyId,
        success: true,
        durationMs: Date.now() - startedAt,
      }
    );

    return result.plaintext;
  } catch (error) {
    writeEncryptionOperationDiagnostic(
      config,
      {
        event: 'decrypt',
        format: isVersioned
          ? 'v2'
          : 'legacy',
        keyId,
        success: false,
        durationMs: Date.now() - startedAt,
        reasonCode: failureReason(error),
      }
    );

    throw error;
  }
}
