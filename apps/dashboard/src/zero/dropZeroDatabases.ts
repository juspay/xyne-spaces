import { dropAllDatabases, dropDatabase } from '@rocicorp/zero';
import { ZERO_STORAGE_KEY } from '../config';

// Zero's dropAllDatabases() deletes every Zero store in the origin, not just this
// client's — which would wipe the SDLC bundle's store (and its unacked mutations)
// whenever the main bundle switches workspace, re-auths or logs out.
//
// Zero names its store `rep:zero-<userID>-<laneKey>:<format>:<schemaVersion>`,
// where laneKey hashes {storageKey, mutateUrl, queryUrl} — build constants, so it
// is stable per bundle. Filtering on it drops this lane's stores for every user
// and schema version without touching the other lane's.

const IDB_PREFIX = 'rep:zero-';

let laneKey: string | null = null;

const laneCacheKey = `xyne:zero-lane:${ZERO_STORAGE_KEY || 'default'}`;

function parseLaneKey(idbName: string): string | null {
  if (!idbName.startsWith(IDB_PREFIX)) return null;
  // userID may contain '-', so take the segment after the LAST one.
  const name = idbName.split(':')[1];
  if (!name) return null;
  return name.slice(name.lastIndexOf('-') + 1) || null;
}

/** Call with `zero.idbName` after constructing the client. */
export function rememberZeroLane(idbName: string): void {
  const key = parseLaneKey(idbName);
  if (!key) return;
  laneKey = key;
  try {
    // Cached so logout can still scope its drop after the client is torn down.
    localStorage.setItem(laneCacheKey, key);
  } catch {
    // Private mode — the in-memory value still covers this session.
  }
}

function currentLaneKey(): string | null {
  if (laneKey) return laneKey;
  try {
    laneKey = localStorage.getItem(laneCacheKey);
  } catch {
    laneKey = null;
  }
  return laneKey;
}

/** Drops this lane's Zero databases. Never rejects. */
export async function dropZeroDatabases(): Promise<void> {
  // Scoped even when this bundle sets no storageKey: the lane key still differs
  // between bundles (it hashes storageKey + mutate/query URLs), and the main
  // bundle is the one that drops most often. Falling back to dropAllDatabases
  // here deleted the other lane's store out from under a live client, which
  // surfaces as Zero's IDBNotFoundError "Expected IndexedDB not found".
  const key = currentLaneKey();
  // Zero never initialised here, so anything we dropped would be the other lane's.
  if (!key) return;

  // Unavailable on Firefox; indexedDBService already depends on it. Bail rather
  // than fall back to a cross-lane wipe.
  if (typeof indexedDB.databases !== 'function') return;

  const databases = await indexedDB.databases().catch(() => []);
  const ours = databases
    .map(db => db.name)
    .filter((name): name is string => !!name && parseLaneKey(name) === key);

  await Promise.all(ours.map(name => dropDatabase(name).catch(() => undefined)));
}

/**
 * Drops every lane's Zero databases. Correct only at logout, where both bundles
 * are torn down. Everywhere else use dropZeroDatabases(): deleting the other
 * lane's store under a live client is what raises IDBNotFoundError.
 */
export async function dropAllZeroDatabases(): Promise<void> {
  await dropAllDatabases().catch(() => undefined);
}
