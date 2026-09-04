/**
 * Durable per-instance op-stream offsets for the sync engine, so a reload can resume
 * (deltas since the offset) instead of a full snapshot.
 *
 * Reuses the app's existing `StorageAdapter` (IndexedDB on web, AsyncStorage on native)
 * — the same primitive the query cache persists through — rather than a second, web-only
 * IDB store. Offsets are keyed by `subKey` (queryName+args), which the client knows at
 * subscribe time (before the server assigns an instanceKey), and are tiny (a handful of
 * currently-subscribed instances), so the whole map is stored under one key.
 *
 * NOTE: the restored offset stays DORMANT until the reload path seeds the MemorySource by
 * flattening the persisted query-cache result — resuming onto an un-seeded (empty) source
 * would yield incomplete data. Until then reload correctly falls back to a full snapshot.
 */
import { getStorageAdapter } from '../machines/queryCacheMachine.js';

const OFFSETS_KEY = 'sync:offsets';

/** Restore the persisted `subKey → offset` map. Empty when no adapter is configured. */
export async function loadPersistedOffsets(): Promise<Record<string, string>> {
  const adapter = getStorageAdapter();
  if (!adapter?.isInitialized()) return {};
  try {
    const value = await adapter.loadContextProperty(OFFSETS_KEY);
    return value && typeof value === 'object' ? { ...(value as Record<string, string>) } : {};
  } catch {
    return {};
  }
}

/** Persist the full `subKey → offset` map. Fire-and-forget; no-op without an adapter. */
export function savePersistedOffsets(offsets: Record<string, string>): void {
  const adapter = getStorageAdapter();
  if (!adapter?.isInitialized()) return;
  void adapter.saveContextProperty(OFFSETS_KEY, offsets).catch(() => {
    /* crash-recovery cache — a dropped write just costs a snapshot next reload */
  });
}
