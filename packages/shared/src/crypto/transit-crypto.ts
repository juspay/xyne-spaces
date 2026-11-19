/** An AES-256-GCM transit key as the active backend holds it: a WebCrypto key or raw bytes. */
export type TransitAesKey = CryptoKey | Uint8Array;

/** HKDF-SHA256 and AES-256-GCM for transit keys; WebCrypto unless a host without it sets another. */
export interface TransitCrypto {
  deriveKey(
    secret: ArrayBuffer,
    salt: Uint8Array<ArrayBuffer>,
    info: Uint8Array<ArrayBuffer>,
  ): Promise<TransitAesKey>;
  encrypt(
    key: TransitAesKey,
    iv: Uint8Array<ArrayBuffer>,
    data: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array>;
  decrypt(
    key: TransitAesKey,
    iv: Uint8Array<ArrayBuffer>,
    data: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array>;
}

export const webCryptoTransitCrypto: TransitCrypto = {
  async deriveKey(secret, salt, info) {
    const hkdfKey = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  },
  async encrypt(key, iv, data) {
    return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key as CryptoKey, data));
  },
  async decrypt(key, iv, data) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key as CryptoKey, data));
  },
};
