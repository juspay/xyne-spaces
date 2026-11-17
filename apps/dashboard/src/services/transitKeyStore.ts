import type { TransitKeyPair } from '@xyne/shared';
import { logger, Event as LogEvent } from '../utils/logger';

/**
 * This browser's transit key pair (ECDH P-256). The private key is generated with
 * `extractable: false`, so page JavaScript can only ask the browser to use it, never read it.
 * It is persisted in IndexedDB as a CryptoKey object and reused on later loads, surviving
 * logout: the transit AES keys are derived from it and the encryption service's public keys,
 * so with a persisted pair the server can encrypt for this browser at any time.
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logTransitKeyWarning(message: string, error?: unknown): void {
  logger.warn(LogEvent.FRONTEND_ERROR, {
    type: 'transit_key',
    message: '[TransitKey] ' + message,
    ...(error !== undefined ? { error: getErrorMessage(error) } : {}),
  });
}

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

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function createTransitKey(): Promise<StoredTransitKey> {
  // Only the private key honours `extractable: false`; the public key is always exportable.
  const keyPair = await crypto.subtle.generateKey(ALGORITHM, false, ['deriveBits']);
  const point = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  return { keyPair, publicKey: toBase64(point), createdAt: Date.now() };
}

/**
 * Returns this browser's transit key pair, creating and persisting it on first use. Returns
 * null when WebCrypto or IndexedDB are unavailable (insecure origin, some private modes), so
 * the caller can fall back to an in-memory pair.
 */
export async function getOrCreateTransitKeyPair(): Promise<TransitKeyPair | null> {
  if (!isSupported()) {
    logTransitKeyWarning('WebCrypto or IndexedDB unavailable — using an in-memory transit key');
    return null;
  }
  try {
    // The lock stops two tabs opened at once from each generating (and overwriting) a pair.
    return await withLock(async () => {
      const existing = await idbGet<StoredTransitKey>(PAIR_KEY);
      if (existing?.keyPair?.privateKey) {
        return { privateKey: existing.keyPair.privateKey, publicKey: existing.publicKey };
      }
      const created = await createTransitKey();
      await idbPut(PAIR_KEY, created);
      return { privateKey: created.keyPair.privateKey, publicKey: created.publicKey };
    });
  } catch (err: unknown) {
    logTransitKeyWarning('Failed to get or create the transit key pair', err);
    return null;
  }
}
