import type { EncryptedTableConfig } from '../zero/query-validation.js';
import type { TransitServerKeys } from './keyring.js';
import { getTransitPlatform } from './transit-platform.js';

export interface EncryptionConfig {
  encryptedFields: Record<string, EncryptedTableConfig>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
  /** Plaintext bytes per chunk of a file uploaded as a transit container (file-container). */
  fileChunkSize: number;
}

export async function fetchEncryptionConfig(): Promise<EncryptionConfig> {
  const response = await getTransitPlatform().http.request('/transit/config');
  if (!response.ok) {
    throw new Error(`Encryption configuration request failed with status ${response.status}`);
  }
  const data = (await response.json()) as Partial<EncryptionConfig>;
  return {
    encryptedFields: data.encryptedFields ?? {},
    clientEncryptionEnabled: data.clientEncryptionEnabled ?? false,
    apiClientEncryptionEnabled: data.apiClientEncryptionEnabled ?? false,
    fileChunkSize: data.fileChunkSize ?? 0,
  };
}

function parseServerKeys(data: unknown): TransitServerKeys {
  const keys = data as Partial<TransitServerKeys> | null;
  if (
    !keys ||
    !Number.isSafeInteger(keys.current) ||
    !Array.isArray(keys.keys) ||
    !keys.keys.every(k => Number.isSafeInteger(k.version) && typeof k.publicKey === 'string')
  ) {
    throw new Error('Transit server keys response is malformed');
  }
  return { current: keys.current!, keys: keys.keys };
}

/** Registers the client's public key for the session and returns the server's public keys. */
export async function registerTransitKey(publicKey: string): Promise<TransitServerKeys> {
  const response = await getTransitPlatform().http.request('/transit/register', {
    method: 'POST',
    body: { publicKey },
  });
  if (!response.ok) {
    throw new Error(`Transit key registration failed with status ${response.status}`);
  }
  return parseServerKeys(await response.json());
}

/** The server's current public keys, for a key id the keyring has not seen (a rotated key). */
export async function fetchTransitServerKeys(): Promise<TransitServerKeys> {
  const response = await getTransitPlatform().http.request('/transit/server-keys');
  if (!response.ok) {
    throw new Error(`Transit server keys request failed with status ${response.status}`);
  }
  return parseServerKeys(await response.json());
}
