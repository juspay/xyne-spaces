import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { setTransitPlatform } from '@xyne/shared';
import type { TransitCrypto, TransitHttp, TransitResponse } from '@xyne/shared';
import { isMtlsRequestError, mtlsRequestJson } from '../MtlsApiService';

/**
 * React Native has no WebCrypto, so HKDF and AES-GCM run in JS here. The derived AES key is in
 * JS memory; the ECDH private key stays in the Keystore (see transitKeyStores.ts).
 */
const nobleTransitCrypto: TransitCrypto = {
  deriveKey: async (secret, salt, info) => hkdf(sha256, new Uint8Array(secret), salt, info, 32),
  encrypt: async (key, iv, data, aad) => gcm(key as Uint8Array, iv, aad).encrypt(data),
  decrypt: async (key, iv, data, aad) => gcm(key as Uint8Array, iv, aad).decrypt(data),
};

const toResponse = (status: number, data?: unknown): TransitResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

/** Transit and manifest calls over the app's mTLS client; the session cookie authenticates them. */
const mobileTransitHttp: TransitHttp = {
  async request(path, { method = 'GET', body } = {}): Promise<TransitResponse> {
    try {
      const data = await mtlsRequestJson<unknown>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return toResponse(200, data);
    } catch (error) {
      if (isMtlsRequestError(error)) return toResponse(error.statusCode);
      throw error;
    }
  },
};

export function installMobileTransitPlatform(): void {
  setTransitPlatform({ crypto: nobleTransitCrypto, http: mobileTransitHttp });
}
