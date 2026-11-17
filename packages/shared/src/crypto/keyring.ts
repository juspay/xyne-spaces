/**
 * The client's P-256 key pair. The private key never leaves its store (WebCrypto, Secure
 * Enclave, TPM, ...); only the result of ECDH with a server public key does.
 */
export interface TransitKeyPair {
  /** Base64 uncompressed point: what the register route stores for the session. */
  publicKey: string;
  /** ECDH with a server's raw uncompressed public point → the 32-byte shared secret. */
  deriveSharedSecret(serverPoint: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
}

export interface TransitServerKey {
  version: number;
  /** Base64 uncompressed P-256 point. */
  publicKey: string;
}

/** The encryption service's public keys; new ciphertext goes under `current`. */
export interface TransitServerKeys {
  current: number;
  keys: TransitServerKey[];
}

/** Where the client's key pair lives between page loads. */
export interface TransitKeyStore {
  getOrCreate(): Promise<TransitKeyPair>;
}

const TRANSIT_KEY_ID_PREFIX = 'tk-';
const DERIVE_INFO = 'transit/v1';
const SOCKET_DERIVE_INFO = 'ysweet-ws/v1';
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

export function transitKeyId(version: number): string {
  return `${TRANSIT_KEY_ID_PREFIX}${version}`;
}

/** The server key version a transit key id names; `null` for anything else. */
export function parseTransitKeyId(keyId: string): number | null {
  if (!keyId.startsWith(TRANSIT_KEY_ID_PREFIX)) return null;
  const rest = keyId.slice(TRANSIT_KEY_ID_PREFIX.length);
  return /^\d+$/.test(rest) ? Number(rest) : null;
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A pair whose private key is a WebCrypto handle (`deriveBits` only), never raw bytes. */
export function webCryptoTransitKeyPair(privateKey: CryptoKey, publicKey: string): TransitKeyPair {
  return {
    publicKey,
    async deriveSharedSecret(serverPoint) {
      const serverKey = await crypto.subtle.importKey('raw', serverPoint, ECDH, false, []);
      return crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, privateKey, 256);
    },
  };
}

/** A fresh non-extractable ECDH pair; the default store keeps it for the page's lifetime. */
export async function generateTransitKeyPair(): Promise<TransitKeyPair> {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const publicKey = toBase64(await crypto.subtle.exportKey('raw', pair.publicKey));
  return webCryptoTransitKeyPair(pair.privateKey, publicKey);
}

/**
 * Static ECDH with one server key version, then HKDF-SHA256 with salt = clientPoint ||
 * serverPoint and info "transit/v1": the same AES-256-GCM key the encryption service
 * derives from its private key and the client's public key.
 */
export async function deriveTransitKey(
  pair: TransitKeyPair,
  serverPublicKey: string,
): Promise<CryptoKey> {
  return deriveFromShared(pair, serverPublicKey, new TextEncoder().encode(DERIVE_INFO));
}

/**
 * The canvas WebSocket key for one socket: the same ECDH secret and salt as the transit key,
 * with info "ysweet-ws/v1" || nonce || docId. The encryption service derives the same key.
 */
export async function deriveSocketKey(
  pair: TransitKeyPair,
  serverPublicKey: string,
  nonce: Uint8Array,
  docId: string,
): Promise<CryptoKey> {
  const label = new TextEncoder().encode(SOCKET_DERIVE_INFO);
  const doc = new TextEncoder().encode(docId);
  const info = new Uint8Array(label.length + nonce.length + doc.length);
  info.set(label, 0);
  info.set(nonce, label.length);
  info.set(doc, label.length + nonce.length);
  return deriveFromShared(pair, serverPublicKey, info);
}

async function deriveFromShared(
  pair: TransitKeyPair,
  serverPublicKey: string,
  info: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const clientPoint = fromBase64(pair.publicKey);
  const serverPoint = fromBase64(serverPublicKey);
  const shared = await pair.deriveSharedSecret(serverPoint);
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array(clientPoint.length + serverPoint.length);
  salt.set(clientPoint, 0);
  salt.set(serverPoint, clientPoint.length);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Transit keys by server key version, derived from the client's key pair and the server's
 * public keys. New ciphertext goes under the current version; any listed version decrypts.
 * A key id naming a version not seen yet (a rotated server key) triggers one refetch of the
 * server keys. Keys never leave memory.
 */
export class TransitKeyring {
  private readonly derived = new Map<number, Promise<CryptoKey>>();
  private serverKeys: TransitServerKeys;
  private refetching: Promise<TransitServerKeys> | null = null;

  constructor(
    private readonly pair: TransitKeyPair,
    serverKeys: TransitServerKeys,
    private readonly fetchServerKeys: () => Promise<TransitServerKeys>,
  ) {
    this.serverKeys = serverKeys;
  }

  /** Base64 P-256 point the client registers for its session (`POST /api/transit/register`). */
  get clientPublicKey(): string {
    return this.pair.publicKey;
  }

  async current(): Promise<{ key: CryptoKey; keyId: string }> {
    const version = this.serverKeys.current;
    return { key: await this.forVersion(version), keyId: transitKeyId(version) };
  }

  async forKeyId(keyId: string): Promise<CryptoKey> {
    const version = parseTransitKeyId(keyId);
    if (version === null) throw new Error(`Not a transit key id: ${keyId}`);
    if (!this.has(version)) {
      await this.refetch();
      if (!this.has(version))
        throw new Error(`Server transit key version ${version} is not available`);
    }
    return this.forVersion(version);
  }

  clear(): void {
    this.derived.clear();
  }

  /** The key for one canvas socket, from the nonce and server key version the ticket carries. */
  async socketKey(version: number, nonce: string, docId: string): Promise<CryptoKey> {
    if (!this.has(version)) {
      await this.refetch();
      if (!this.has(version))
        throw new Error(`Server transit key version ${version} is not available`);
    }
    const server = this.serverKeys.keys.find(k => k.version === version)!;
    return deriveSocketKey(this.pair, server.publicKey, fromBase64(nonce), docId);
  }

  private has(version: number): boolean {
    return this.serverKeys.keys.some(k => k.version === version);
  }

  private forVersion(version: number): Promise<CryptoKey> {
    let pending = this.derived.get(version);
    if (!pending) {
      const server = this.serverKeys.keys.find(k => k.version === version);
      if (!server)
        return Promise.reject(new Error(`Server transit key version ${version} is not available`));
      pending = deriveTransitKey(this.pair, server.publicKey);
      pending.catch(() => this.derived.delete(version));
      this.derived.set(version, pending);
    }
    return pending;
  }

  private refetch(): Promise<TransitServerKeys> {
    if (!this.refetching) {
      this.refetching = this.fetchServerKeys()
        .then(keys => {
          this.serverKeys = keys;
          return keys;
        })
        .finally(() => {
          this.refetching = null;
        });
    }
    return this.refetching;
  }
}
