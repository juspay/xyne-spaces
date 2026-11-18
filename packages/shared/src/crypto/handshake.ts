import { API_BASE_URL } from '../config.js';
import type { EncryptedTableConfig } from '../zero/query-validation.js';
import type { TransitKey } from './keyring.js';

export interface EncryptionConfig {
  encryptedFields: Record<string, EncryptedTableConfig>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
}

const WRAP_INFO = 'handshake/v1';
const IV_LENGTH = 12;

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function fetchEncryptionConfig(): Promise<EncryptionConfig> {
  const response = await fetch(`${API_BASE_URL}/transit/config`, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Encryption configuration request failed with status ${response.status}`);
  }
  const data = (await response.json()) as Partial<EncryptionConfig>;
  return {
    encryptedFields: data.encryptedFields ?? {},
    clientEncryptionEnabled: data.clientEncryptionEnabled ?? false,
    apiClientEncryptionEnabled: data.apiClientEncryptionEnabled ?? false,
  };
}

/**
 * Ephemeral ECDH with the server; the traffic key comes back wrapped under the shared
 * secret, is unwrapped locally and imported non-extractable. Both ECDH keys are discarded
 * afterwards. With `ticket`, the server returns the key that ticket seals instead of a new one.
 */
export async function handshake(ticket?: string): Promise<TransitKey> {
  const ecdh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  const clientPoint = await crypto.subtle.exportKey('raw', ecdh.publicKey);

  const response = await fetch(`${API_BASE_URL}/transit/handshake`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: toBase64(clientPoint), ticket }),
  });
  if (!response.ok) {
    throw new Error(`Transit handshake failed with status ${response.status}`);
  }
  const data = (await response.json()) as {
    publicKey?: string;
    wrappedKey?: string;
    ticket?: string;
    expiresAt?: number;
  };
  if (!data.publicKey || !data.wrappedKey || !data.ticket || !Number.isSafeInteger(data.expiresAt)) {
    throw new Error('Transit handshake response is incomplete');
  }

  const serverPoint = fromBase64(data.publicKey);
  const serverKey = await crypto.subtle.importKey(
    'raw',
    serverPoint,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, ecdh.privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array(clientPoint.byteLength + serverPoint.byteLength);
  salt.set(new Uint8Array(clientPoint), 0);
  salt.set(serverPoint, clientPoint.byteLength);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(WRAP_INFO) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const wrapped = fromBase64(data.wrappedKey);
  const rawKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: wrapped.slice(0, IV_LENGTH) },
    wrappingKey,
    wrapped.slice(IV_LENGTH),
  );
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);

  return { key, ticket: data.ticket, expiresAt: data.expiresAt! };
}
