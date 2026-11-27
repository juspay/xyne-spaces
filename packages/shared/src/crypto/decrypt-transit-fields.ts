import { Event } from '../logger/events.js';
import { getCryptoLogger } from './crypto-logger.js';
import { decryptionCache } from './decryption-cache.js';
import { decryptField, isCiphertextValue } from './field-decrypt.js';
import type { TransitKeyring } from './keyring.js';

/**
 * Decrypts every transit-encrypted string in a JSON value (an API response), using the cache.
 * Text that only starts with `ENC:` is left alone, and a field that fails to decrypt (a key
 * this client no longer has) stays as received, so one field never fails the whole response.
 */
export async function decryptTransitFields(value: unknown, keyring: TransitKeyring): Promise<unknown> {
  if (isCiphertextValue(value)) {
    const cached = decryptionCache.get(value);
    if (cached !== undefined) return cached;
    try {
      const decrypted = await decryptField(value, keyring);
      decryptionCache.set(value, decrypted);
      return decrypted;
    } catch (error) {
      getCryptoLogger().error(Event.ENCRYPTION_FIELD_DECRYPT, {
        message: '[encryptionlog] Response field decryption failed; left as received',
        format: value.split('|')[0],
        error: error instanceof Error ? error.message : String(error),
      });
      return value;
    }
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => decryptTransitFields(item, keyring)));
  if (value === null || typeof value !== 'object') return value;
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, item]) => [key, await decryptTransitFields(item, keyring)] as const),
  );
  return Object.fromEntries(entries);
}
