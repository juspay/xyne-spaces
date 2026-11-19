import { decryptionCache } from './decryption-cache.js';
import { decryptField, isEncryptedField } from './field-decrypt.js';
import type { TransitKeyring } from './keyring.js';

/** Decrypts every transit-encrypted string in a JSON value (an API response), using the cache. */
export async function decryptTransitFields(value: unknown, keyring: TransitKeyring): Promise<unknown> {
  if (isEncryptedField(value)) {
    const cached = decryptionCache.get(value);
    if (cached !== undefined) return cached;
    const decrypted = await decryptField(value, keyring);
    decryptionCache.set(value, decrypted);
    return decrypted;
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => decryptTransitFields(item, keyring)));
  if (value === null || typeof value !== 'object') return value;
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, item]) => [key, await decryptTransitFields(item, keyring)] as const),
  );
  return Object.fromEntries(entries);
}
