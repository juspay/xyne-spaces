import { getEncryptionProvider } from './provider';

// Storage ciphertext (`ENC:v1|<dekId>|…`); session ciphertext (`ENC:v1|sess|…`) is excluded.
const SERVER_CIPHERTEXT_PATTERN = /^ENC:v1\|(?!sess\|)[^|]+\|/;

/** True when any string in `value` (searched recursively) is storage ciphertext. */
export function containsServerCiphertext(value: unknown): boolean {
  if (typeof value === 'string') return SERVER_CIPHERTEXT_PATTERN.test(value);

  if (Array.isArray(value)) return value.some(containsServerCiphertext);

  if (value && typeof value === 'object') {
    return Object.values(value).some(containsServerCiphertext);
  }

  return false;
}

/** DEK→CEK for one recipient: storage ciphertext in `payload` becomes ciphertext under `sessionId`. */
export async function transformPayloadForSession<T>(payload: T, sessionId: string): Promise<T> {
  return getEncryptionProvider().transformResponse(payload, sessionId);
}
