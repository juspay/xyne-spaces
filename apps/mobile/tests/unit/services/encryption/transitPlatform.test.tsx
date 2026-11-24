/**
 * The mobile transit crypto (noble HKDF + AES-GCM) must give exactly what WebCrypto gives on
 * web and desktop, or the server and the app derive different transit keys.
 */
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { TransitCrypto, TransitHttp } from '@xyne/shared';

let installed: { crypto: TransitCrypto; http: TransitHttp } | undefined;
const mockRequestJson = jest.fn<(path: string, options?: unknown) => Promise<unknown>>();

jest.mock('@xyne/shared', () => ({
  setTransitPlatform: (next: { crypto: TransitCrypto; http: TransitHttp }) => {
    installed = next;
  },
}));

jest.mock('@/src/services/MtlsApiService', () => ({
  mtlsRequestJson: (path: string, options?: unknown) => mockRequestJson(path, options),
  isMtlsRequestError: () => false,
}));

const subtle = webcrypto.subtle;
const bytes = (length: number, seed: number): Uint8Array<ArrayBuffer> =>
  Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff);

// Fixed test vector: a 32-byte ECDH secret, salt, info, IV and plaintext.
const SECRET = bytes(32, 7);
const SALT = bytes(16, 3);
const INFO = new TextEncoder().encode('transit/v1');
const IV = bytes(12, 11);
const PLAINTEXT = new TextEncoder().encode('Lunch at 1?');

async function webCryptoEncrypt(): Promise<Uint8Array> {
  const hkdfKey = await subtle.importKey('raw', SECRET, 'HKDF', false, ['deriveKey']);
  const aesKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: INFO },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: IV }, aesKey, PLAINTEXT));
}

beforeAll(() => {
  const { installMobileTransitPlatform } =
    require('@/src/services/encryption/transitPlatform') as typeof import('@/src/services/encryption/transitPlatform');
  installMobileTransitPlatform();
});

describe('mobile transit crypto', () => {
  it('derives the same key and ciphertext as WebCrypto', async () => {
    const key = await installed!.crypto.deriveKey(SECRET.buffer, SALT, INFO);
    const mobile = await installed!.crypto.encrypt(key, IV, PLAINTEXT);

    expect(Array.from(mobile)).toEqual(Array.from(await webCryptoEncrypt()));
  });

  it('decrypts what WebCrypto encrypted', async () => {
    const key = await installed!.crypto.deriveKey(SECRET.buffer, SALT, INFO);
    const ciphertext = await webCryptoEncrypt();

    const plain = await installed!.crypto.decrypt(key, IV, new Uint8Array(ciphertext));

    expect(new TextDecoder().decode(plain)).toBe('Lunch at 1?');
  });
});

describe('mobile transit http', () => {
  it('sends no Authorization header; the session cookie authenticates', async () => {
    mockRequestJson.mockResolvedValue({ ok: true });

    await installed!.http.request('/transit/register', { method: 'POST', body: { k: 1 } });

    const options = mockRequestJson.mock.calls[0]?.[1] as { headers?: Record<string, string> };
    expect(options.headers?.['Authorization']).toBeUndefined();
  });
});
