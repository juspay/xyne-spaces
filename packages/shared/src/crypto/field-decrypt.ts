import { Event } from '../logger/events.js';
import { getCryptoLogger } from './crypto-logger.js';
import type { TransitKeyring } from './keyring.js';

const IV_LENGTH = 12;
const CIPHERTEXT_VERSION = 'v1';
const TRANSIT_KEY_ID_PREFIX = 'tk-';

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export async function encryptField(
  plaintext: string,
  keyring: TransitKeyring,
  fieldName?: string,
  tableName?: string,
): Promise<string> {
  const logger = getCryptoLogger();
  try {
    const { key, epoch } = await keyring.current();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

    const combined = new Uint8Array(IV_LENGTH + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), IV_LENGTH);

    return `ENC:${CIPHERTEXT_VERSION}|${TRANSIT_KEY_ID_PREFIX}${epoch}|${toBase64(combined)}`;
  } catch (error) {
    logger.error(Event.ENCRYPTION_FIELD_ENCRYPT, {
      message: `[encryptionlog] Field encryption failed${fieldName ? `: ${fieldName}` : ''}`,
      field: fieldName || 'unknown',
      table: tableName || 'unknown',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function decryptField(encoded: string, keyring: TransitKeyring): Promise<string> {
  const parts = encoded.split('|');
  if (parts.length < 3) {
    throw new Error('Invalid encrypted field format');
  }
  const keyId = parts[1];
  if (!keyId.startsWith(TRANSIT_KEY_ID_PREFIX)) {
    throw new Error(`Field is not encrypted with a transit key: ${keyId}`);
  }
  const epoch = Number(keyId.slice(TRANSIT_KEY_ID_PREFIX.length));
  if (!Number.isSafeInteger(epoch)) {
    throw new Error(`Invalid transit key id: ${keyId}`);
  }

  const binary = atob(parts.slice(2).join('|'));
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);
  if (combined.length < IV_LENGTH + 1) {
    throw new Error('Encrypted data too short');
  }

  const key = await keyring.forEpoch(epoch);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, IV_LENGTH) },
    key,
    combined.slice(IV_LENGTH),
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Ciphertext is self-describing (`ENC:` prefix + key id), so this predicate
 * alone decides what a read path decrypts; no config is consulted.
 */
export function isEncryptedField(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('ENC:');
}
