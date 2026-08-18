// Tiny IndexedDB record holding ONLY the user's chosen File System Access
// directory handle (structured-cloneable). Audio bytes never enter IndexedDB —
// they live in the user's real filesystem. The browser remains the permission
// authority; we re-check queryPermission/requestPermission on each launch.

const DB_NAME = 'xyne-recording-fs';
const STORE = 'handles';
const KEY = 'recordingDir';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (): void => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = (): void => resolve(request.result);
      tx.onerror = (): void => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = (): void => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function getSavedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const value = await withStore<FileSystemDirectoryHandle | undefined>(
      'readonly',
      store => store.get(KEY) as IDBRequest<FileSystemDirectoryHandle | undefined>,
    );
    return value ?? null;
  } catch {
    return null;
  }
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore<IDBValidKey>('readwrite', store => store.put(handle, KEY));
}

export async function clearSavedDirectoryHandle(): Promise<void> {
  await withStore<undefined>('readwrite', store => store.delete(KEY)).catch(() => undefined);
}
