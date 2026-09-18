import crypto from 'crypto';
import type { EncryptionAdapter } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const FORMAT_PREFIX = 'ENC:v1|vault|';

/** Parses a hex-encoded key string into the 32-byte Buffer AES-256 requires. */
export function parseHexEncryptionKey(raw: string): Buffer {
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)');
  }
  return key;
}

/**
 * Fallback encryption used when the generic EncryptionProvider (apps/backend/src/services/
 * encryption/provider.ts) is disabled via config.enc.enableDbEncryption. Callers supply the
 * key (e.g. from their own ENCRYPTION_KEY env var — this package doesn't assume any env var
 * name); follows the credentialEnvelope.ts pattern (AES-256-GCM + AAD) rather than CBC, since
 * GCM is authenticated.
 */
export function createCustomEncryptionAdapter(key: Buffer): EncryptionAdapter {
  return {
    async encrypt(plaintext: string, aad: string): Promise<string> {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      cipher.setAAD(Buffer.from(aad, 'utf8'));

      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const combined = Buffer.concat([iv, ciphertext, authTag]);
      return `${FORMAT_PREFIX}${combined.toString('base64')}`;
    },

    async decrypt(packed: string, aad: string): Promise<string> {
      if (!packed.startsWith(FORMAT_PREFIX)) {
        throw new Error('Invalid encrypted value format for custom vault adapter');
      }
      const combined = Buffer.from(packed.slice(FORMAT_PREFIX.length), 'base64');
      if (combined.length < IV_LENGTH + 16) {
        throw new Error('Encrypted value too short');
      }

      const iv = combined.subarray(0, IV_LENGTH);
      const authTag = combined.subarray(combined.length - 16);
      const ciphertext = combined.subarray(IV_LENGTH, combined.length - 16);

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    },
  };
}
