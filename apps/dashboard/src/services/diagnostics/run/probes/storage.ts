import type { StorageProbeResult } from '../types';

/**
 * IndexedDB read/write timing.
 *
 * Zero keeps its client store in IndexedDB, so a machine with slow or contended
 * IDB presents as a slow *app*: queries that are served locally still wait on
 * the disk. Nothing else in the panel can see that, and it is a fault no amount
 * of script attribution would ever point at.
 *
 * Writes to its own database and deletes it afterwards, so it can never touch
 * the diagnostics history store or anything Zero owns.
 */

const DB_NAME = 'xyne-diagnostics-probe';
const STORE_NAME = 'probe';
const RECORD_COUNT = 40;
const RECORD_BYTES = 8 * 1024;
const BYTES_PER_MB = 1024 * 1024;
/** A machine this slow at IDB has a storage problem, not a timing question. */
const TIMEOUT_MS = 10_000;

function unsupported(reason: string): StorageProbeResult {
  return {
    supported: false,
    unsupportedReason: reason,
    writeMs: 0,
    readMs: 0,
    deleteMs: 0,
    bytes: 0,
    writeMbPerSecond: 0,
    usageMb: null,
    quotaMb: null,
  };
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function openProbeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open probe database'));
    request.onblocked = () => reject(new Error('Probe database is blocked'));
  });
}

function runTransaction(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    // Timing the transaction's completion, not the request's: the write is not
    // durable until the transaction commits, and the commit is where a slow
    // disk actually shows up.
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Probe transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Probe transaction aborted'));
    work(tx.objectStore(STORE_NAME));
  });
}

function readAll(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result.length);
    request.onerror = () => reject(request.error ?? new Error('Probe read failed'));
  });
}

function deleteProbeDb(): Promise<void> {
  return new Promise(resolve => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    // Cleanup failure is not a diagnostic result — the database is small and
    // will be reused by the next run either way.
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function readQuota(): Promise<{ usageMb: number | null; quotaMb: number | null }> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return {
      usageMb: typeof estimate?.usage === 'number' ? estimate.usage / BYTES_PER_MB : null,
      quotaMb: typeof estimate?.quota === 'number' ? estimate.quota / BYTES_PER_MB : null,
    };
  } catch {
    return { usageMb: null, quotaMb: null };
  }
}

export async function runStorageProbe(): Promise<StorageProbeResult> {
  if (typeof indexedDB === 'undefined') {
    return unsupported('This browser does not provide IndexedDB.');
  }

  const payload = 'x'.repeat(RECORD_BYTES);
  const totalBytes = RECORD_BYTES * RECORD_COUNT;
  let db: IDBDatabase | null = null;

  try {
    db = await withTimeout(openProbeDb(), 'Opening storage');
    const openedDb = db;

    const writeStartedAt = performance.now();
    await withTimeout(
      runTransaction(openedDb, 'readwrite', store => {
        for (let i = 0; i < RECORD_COUNT; i++) store.put({ i, payload }, i);
      }),
      'Storage write',
    );
    const writeMs = performance.now() - writeStartedAt;

    const readStartedAt = performance.now();
    await withTimeout(readAll(openedDb), 'Storage read');
    const readMs = performance.now() - readStartedAt;

    const deleteStartedAt = performance.now();
    await withTimeout(
      runTransaction(openedDb, 'readwrite', store => store.clear()),
      'Storage clear',
    );
    const deleteMs = performance.now() - deleteStartedAt;

    const quota = await readQuota();

    return {
      supported: true,
      unsupportedReason: '',
      writeMs,
      readMs,
      deleteMs,
      bytes: totalBytes,
      writeMbPerSecond: writeMs > 0 ? totalBytes / BYTES_PER_MB / (writeMs / 1000) : 0,
      ...quota,
    };
  } catch (error) {
    return unsupported(
      error instanceof Error ? error.message : 'Storage could not be measured on this device.',
    );
  } finally {
    db?.close();
    await deleteProbeDb();
  }
}
