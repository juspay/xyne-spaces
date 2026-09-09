/**
 * Encryption Service
 * AES-256-CBC encryption/decryption for sensitive data
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // AES block size

/**
 * Get encryption key from environment
 * Must be 32 bytes (64 hex characters) for AES-256
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error('ENCRYPTION_KEY not found in environment variables');
  }

  // Convert hex string to buffer
  const keyBuffer = Buffer.from(key, 'hex');

  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  return keyBuffer;
}

/**
 * Encrypt plaintext using AES-256-CBC
 * Returns format: "IV:ciphertext" (both as hex)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Return IV:ciphertext format
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt ciphertext using AES-256-CBC
 * Expects format: "IV:ciphertext" (both as hex)
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();

  // Split IV and ciphertext
  const parts = encryptedData.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted data format. Expected "IV:ciphertext"');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length. Expected ${IV_LENGTH} bytes`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
