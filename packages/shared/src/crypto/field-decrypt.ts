const IV_LENGTH = 12;

import { Event } from '../logger/events.js';
import { getCryptoLogger } from './crypto-logger.js';

export async function encryptField(
  plaintext: string,
  key: CryptoKey,
  fieldName?: string,
  tableName?: string,
): Promise<string> {
  const logger = getCryptoLogger();
  const inputLength = plaintext.length;

  logger.info(Event.ENCRYPTION_FIELD_ENCRYPT, {
    message: `[encryptionlog] Field encryption started${fieldName ? `: ${fieldName}` : ''}`,
    field: fieldName || 'unknown',
    table: tableName || 'unknown',
    inputLength,
  });

  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

    const combined = new Uint8Array(IV_LENGTH + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), IV_LENGTH);

    const base64 = btoa(String.fromCharCode(...combined));
    const result = `ENC:v1|sess|${base64}`;

    logger.info(Event.ENCRYPTION_FIELD_ENCRYPT, {
      message: `[encryptionlog] Field encryption successful${fieldName ? `: ${fieldName}` : ''}`,
      field: fieldName || 'unknown',
      table: tableName || 'unknown',
      inputLength,
      outputFormat: result.substring(0, 20) + '...',
      outputPrefix: result.substring(0, 4),
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(Event.ENCRYPTION_FIELD_ENCRYPT, {
      message: `[encryptionlog] Field encryption failed${fieldName ? `: ${fieldName}` : ''}`,
      field: fieldName || 'unknown',
      table: tableName || 'unknown',
      inputLength,
      error: errorMessage,
    });
    throw error;
  }
}

export async function decryptField(encoded: string, key: CryptoKey): Promise<string> {
  const parts = encoded.split('|');
  if (parts.length < 3) {
    throw new Error('Invalid encrypted field format');
  }

  const base64Data = parts.slice(2).join('|');
  const combined = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

  if (combined.length < IV_LENGTH + 1) {
    throw new Error('Encrypted data too short');
  }

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertextWithTag = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertextWithTag);

  return new TextDecoder().decode(decrypted);
}

export function isEncryptedField(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('ENC:');
}
