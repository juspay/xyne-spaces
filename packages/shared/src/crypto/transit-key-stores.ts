import { toBase64, TransitKeyUnavailableError, webCryptoTransitKeyPair } from './keyring.js';
import type { TransitKeyPair, TransitKeyStore } from './keyring.js';

/**
 * The browser's transit key pair (ECDH P-256). The private key is generated with
 * `extractable: false`, so page JavaScript can only ask the browser to use it, never read it.
 * It is persisted in IndexedDB as a CryptoKey object and reused on later loads, surviving
 * logout: the transit AES keys are derived from it and the encryption service's public keys,
 * so with a persisted pair the server can encrypt for this browser at any time.
 * This is the browser's store: a page has no secure hardware to use. Desktop builds with the
 * main-process key never use it (see the dashboard's EncryptionBootstrapProvider).
 */

const DB_NAME = 'xyne-transit-key';
const DB_VERSION = 1;
const STORE = 'keys';
const PAIR_KEY = 'pair';
const LOCK_NAME = 'xyne-transit-key';

const ALGORITHM: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };

interface StoredTransitKey {
  keyPair: CryptoKeyPair;
  /** Base64 uncompressed P-256 point. */
  publicKey: string;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof crypto !== 'undefined' &&
    !!crypto.subtle &&
    typeof indexedDB !== 'undefined'
  );
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (): void => reject(new Error('Failed to open transit key IndexedDB'));
    request.onsuccess = (): void => resolve(request.result);
    request.onupgradeneeded = (event): void => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  }).catch((err: unknown) => {
    // Let the next call retry instead of caching the failure forever.
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction([STORE], 'readonly').objectStore(STORE).get(key);
    request.onsuccess = (): void => resolve(request.result as T | undefined);
    request.onerror = (): void =>
      reject(new Error('Failed to read the transit key from IndexedDB'));
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction([STORE], 'readwrite').objectStore(STORE).put(value, key);
    request.onsuccess = (): void => resolve();
    request.onerror = (): void => reject(new Error('Failed to write the transit key to IndexedDB'));
  });
}

async function withLock<R>(fn: () => Promise<R>): Promise<R> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(LOCK_NAME, fn);
  }
  return fn();
}

async function createTransitKey(): Promise<StoredTransitKey> {
  // Only the private key honours `extractable: false`; the public key is always exportable.
  const keyPair = await crypto.subtle.generateKey(ALGORITHM, false, ['deriveBits']);
  const point = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  return { keyPair, publicKey: toBase64(point), createdAt: Date.now() };
}

function toPair(stored: StoredTransitKey): TransitKeyPair {
  return webCryptoTransitKeyPair(stored.keyPair.privateKey, stored.publicKey);
}

/** Login waits on the transit key, so a store that hangs fails after this long. */
const STORE_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

/**
 * The persisted browser pair, created on first use. Throws TransitKeyUnavailableError when
 * WebCrypto or IndexedDB are unavailable (insecure origin, some private modes) or fail: there is
 * no key for this page load alone, which the next reload would replace.
 */
export const indexedDbTransitKeyStore: TransitKeyStore = {
  async getOrCreate(): Promise<TransitKeyPair> {
    if (!isSupported()) {
      throw new TransitKeyUnavailableError('indexeddb', 'WebCrypto or IndexedDB unavailable');
    }
    // The lock stops two tabs opened at once from each generating (and overwriting) a pair.
    try {
      return await withTimeout(
        withLock(async () => {
          const existing = await idbGet<StoredTransitKey>(PAIR_KEY);
          if (existing?.keyPair?.privateKey) return toPair(existing);
          const created = await createTransitKey();
          await idbPut(PAIR_KEY, created);
          return toPair(created);
        }),
        STORE_TIMEOUT_MS,
      );
    } catch (error: unknown) {
      throw new TransitKeyUnavailableError(
        'indexeddb',
        error instanceof Error ? error.message : String(error),
      );
    }
  },
};
