import { METRIC_SPECS } from './thresholds';
import type { DiagnosticsStore } from './store';
import type { MetricKey, Point } from './types';

const DB_NAME = 'xyne-diagnostics';
const DB_VERSION = 1;
const STORE_NAME = 'series';

const RETENTION_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 60_000;
const FLUSH_INTERVAL_MS = 60_000;

interface PersistedSeries {
  key: MetricKey;
  points: Point[];
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    // Private browsing and storage-pressure eviction both surface here. History
    // is a nice-to-have; the live panel works without it.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/**
 * Collapse raw samples to one point per minute so a day of history stays small.
 * The representative value is the *worst* in each bucket — averaging would hide
 * exactly the spikes a user opens this panel to find.
 */
function downsample(key: MetricKey, points: Point[]): Point[] {
  const direction = METRIC_SPECS[key].direction;
  const buckets = new Map<number, Point>();
  for (const point of points) {
    const bucket = Math.floor(point.t / BUCKET_MS) * BUCKET_MS;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { t: bucket, v: point.v });
      continue;
    }
    const worse = direction === 'lower' ? point.v > current.v : point.v < current.v;
    if (worse) current.v = point.v;
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

function mergeAndTrim(existing: Point[], incoming: Point[], cutoff: number): Point[] {
  const merged = new Map<number, number>();
  for (const point of existing) merged.set(point.t, point.v);
  for (const point of incoming) merged.set(point.t, point.v);
  return [...merged.entries()]
    .filter(([t]) => t >= cutoff)
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, v }));
}

export async function loadHistory(): Promise<Partial<Record<MetricKey, Point[]>>> {
  const db = await openDb();
  if (!db) return {};
  const cutoff = Date.now() - RETENTION_MS;

  return new Promise(resolve => {
    const out: Partial<Record<MetricKey, Point[]>> = {};
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        for (const row of request.result as PersistedSeries[]) {
          const points = row.points.filter(p => p.t >= cutoff);
          if (points.length) out[row.key] = points;
        }
        resolve(out);
      };
      request.onerror = () => resolve({});
      tx.oncomplete = () => db.close();
    } catch {
      resolve({});
    }
  });
}

export async function flushHistory(store: DiagnosticsStore): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const cutoff = Date.now() - RETENTION_MS;
  const series = store.exportSeries();

  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const objectStore = tx.objectStore(STORE_NAME);

      for (const [key, points] of Object.entries(series) as [MetricKey, Point[]][]) {
        if (!points?.length) continue;
        const incoming = downsample(key, points);
        const read = objectStore.get(key);
        read.onsuccess = () => {
          const existing = (read.result as PersistedSeries | undefined)?.points ?? [];
          objectStore.put({ key, points: mergeAndTrim(existing, incoming, cutoff) });
        };
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearHistory(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Periodic flush plus a `pagehide` flush, because a tab that is closed or
 * crashes is exactly the session whose history matters most.
 */
export function startPersistence(store: DiagnosticsStore): () => void {
  const interval = setInterval(() => {
    void flushHistory(store);
  }, FLUSH_INTERVAL_MS);

  const onHide = (): void => {
    void flushHistory(store);
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') onHide();
  };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    clearInterval(interval);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
