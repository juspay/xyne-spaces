import { getEncryptionProvider } from './provider';
import type { TransitCaller, TransitEncryptResult } from './types';

// Storage ciphertext (`ENC:v1|<dekId>|…`); transit ciphertext (`ENC:v1|tk-…|…`) is excluded.
const SERVER_CIPHERTEXT_PATTERN = /^ENC:v1\|(?!tk-)[^|]+\|/;

/** True when any string in `value` (searched recursively) is storage ciphertext. */
export function containsServerCiphertext(value: unknown): boolean {
  if (typeof value === 'string') return SERVER_CIPHERTEXT_PATTERN.test(value);

  if (Array.isArray(value)) return value.some(containsServerCiphertext);

  if (value && typeof value === 'object') {
    return Object.values(value).some(containsServerCiphertext);
  }

  return false;
}

/**
 * Storage ciphertext in `payload` becomes transit ciphertext for one recipient: the
 * client of `caller` (its session's registered transit key).
 */
export async function transformPayloadForClient<T>(payload: T, caller: TransitCaller): Promise<TransitEncryptResult<T>> {
  return getEncryptionProvider().transformResponse(payload, caller);
}
