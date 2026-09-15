import { logger, Event as LogEvent } from '../utils/logger';

const DB_NAME = 'xyne-encryption-keys';
const STORE_NAME = 'session-keys';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logSessionKeyStoreError(message: string, error: unknown): void {
  logger.error(LogEvent.FRONTEND_ERROR, {
    type: 'migrated_console_error',
    message: String('[SessionKeyStore] ' + message),
    error: getErrorMessage(error),
  });
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (): void => reject(new Error('Failed to open encryption key IndexedDB'));
    request.onsuccess = (): void => resolve(request.result);
    request.onupgradeneeded = (event): void => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
  return dbPromise;
}

export async function exportRawKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key);
}

export async function importRawKey(rawKey: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

async function getDB(): Promise<IDBDatabase> {
  return openDB();
}

export async function getStoredSessionKey(fingerprint: string): Promise<CryptoKey | null> {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(fingerprint);
      request.onsuccess = (): void => {
        const raw = request.result as ArrayBuffer | undefined;
        if (!raw) {
          resolve(null);
          return;
        }
        importRawKey(raw)
          .then((key): void => resolve(key))
          .catch((err: unknown): void => reject(toError(err)));
      };
      request.onerror = (): void => reject(new Error('Failed to read session key from IndexedDB'));
    });
  } catch (err: unknown) {
    logSessionKeyStoreError('[encryption] Failed to get stored session key', err);
    return null;
  }
}

export async function storeSessionKey(fingerprint: string, key: CryptoKey): Promise<void> {
  try {
    const raw = await exportRawKey(key);
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(raw, fingerprint);
      request.onsuccess = (): void => resolve();
      request.onerror = (): void => reject(new Error('Failed to write session key to IndexedDB'));
    });
  } catch (err: unknown) {
    logSessionKeyStoreError('[encryption] Failed to store session key', err);
    throw toError(err);
  }
}

export async function clearSessionKey(fingerprint: string): Promise<void> {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(fingerprint);
      request.onsuccess = (): void => resolve();
      request.onerror = (): void =>
        reject(new Error('Failed to delete session key from IndexedDB'));
    });
  } catch (err: unknown) {
    logSessionKeyStoreError('[encryption] Failed to clear session key', err);
  }
}

export async function clearAllSessionKeys(): Promise<void> {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = (): void => resolve();
      request.onerror = (): void =>
        reject(new Error('Failed to clear session keys from IndexedDB'));
    });
  } catch (err: unknown) {
    logSessionKeyStoreError('[encryption] Failed to clear all session keys', err);
  }
}

export async function acquireSessionKeyLock<R>(
  fingerprint: string,
  fn: () => Promise<R>,
): Promise<R> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(`xyne-session-key-${fingerprint}`, fn);
  }
  return fn();
}
