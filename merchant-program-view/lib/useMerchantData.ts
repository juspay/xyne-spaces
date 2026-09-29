import { useCallback, useEffect, useRef, useState } from 'react';
import { spaces, storage, storageAvailable } from './xyne';
import { CACHE_COLLECTION, loadCache, saveCache, userKV, type KV } from './cache';
import { FULL_RELOAD_AFTER_MS, SYNC_OVERLAP_MS } from './config';
import { emptyStore, expandUp, hydrateLookups, loadAll, ticketIdsForMid, type DataStore } from './load';
import { syncStore } from './sync';
import { updateSummaryText, type UpdateActivity } from './format';
import type { LoadProgress, LoadWarning, Lookups } from './types';

const IDLE: LoadProgress = { phase: 'boot', projectsDone: 0, projectsTotal: 0, desksDone: 0, desksTotal: 0 };

/** 'off': no app storage (app not pushed yet); 'none': nothing cached yet; 'cached': a snapshot is saved. */
export type CacheState = 'off' | 'none' | 'cached';

export interface MerchantData {
  /** The loaded tickets and links; mutated in place, so read it together with `version`. */
  store: DataStore;
  /** Changes whenever `store` does. */
  version: number;
  lookups: Lookups;
  progress: LoadProgress;
  /** True until there is any data to show. */
  loading: boolean;
  /** A sync or full load is running. */
  busy: boolean;
  /** What is running, for the update bar; null when idle. */
  activity: UpdateActivity | null;
  /** The saved snapshot is being read (before anything is shown). */
  opening: boolean;
  /** How the last load or sync ended, e.g. "Up to date · 3 new"; `at` changes on every result. */
  summary: { text: string; at: number } | null;
  /** When the shown data was last brought up to date. */
  syncedAt: number | null;
  loadedAt: number | null;
  cacheState: CacheState;
  error: string | null;
  warnings: LoadWarning[];
  resolvingParents: boolean;
  /** Fetch only what changed since the last sync (full load when nothing is cached). */
  refresh: () => void;
  /** Reload everything from scratch. */
  fullReload: () => void;
  resolveParents: (mid: string) => void;
}

export function useMerchantData(): MerchantData {
  const storeRef = useRef<DataStore>(emptyStore());
  const runRef = useRef(0);
  const kvRef = useRef<KV | null>(storageAvailable ? userKV(storage.collection(CACHE_COLLECTION)) : null);
  /** When the data in memory was last fully loaded / synced — kept even when the cache is off. */
  const syncRef = useRef<{ lastFullAt: number; lastSyncAt: number } | null>(null);
  const [version, setVersion] = useState(0);
  const [progress, setProgress] = useState<LoadProgress>(IDLE);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [activity, setActivity] = useState<UpdateActivity | null>(null);
  const [summary, setSummary] = useState<{ text: string; at: number } | null>(null);
  const [opening, setOpening] = useState(kvRef.current !== null);
  const [cacheState, setCacheState] = useState<CacheState>(kvRef.current ? 'none' : 'off');
  const [error, setError] = useState<string | null>(null);
  const [resolvingParents, setResolvingParents] = useState(false);

  const persist = useCallback((store: DataStore, times: { lastFullAt: number; lastSyncAt: number }) => {
    syncRef.current = times;
    const kv = kvRef.current;
    if (!kv) return;
    saveCache(kv, store, times)
      .then(() => setCacheState('cached'))
      .catch(() => {
        // A failed save only costs the next open a slower start.
      });
  }, []);

  const fullReload = useCallback(() => {
    runRef.current += 1;
    const run = runRef.current;
    const startedAt = Date.now();
    // With data on screen, keep showing it until the new load finishes; otherwise render as it arrives.
    const progressive = storeRef.current.tickets.size === 0;
    setError(null);
    setProgress(IDLE);
    setActivity({ mode: 'full', since: null });
    loadAll(spaces, (store, p) => {
      if (run !== runRef.current) return;
      setProgress(p);
      if (progressive) {
        storeRef.current = store;
        setVersion(v => v + 1);
      }
    })
      .then(store => {
        if (run !== runRef.current) return;
        storeRef.current = store;
        setVersion(v => v + 1);
        setLoadedAt(Date.now());
        setSyncedAt(startedAt);
        setSummary({ text: updateSummaryText({ added: 0, updated: 0 }), at: Date.now() });
        persist(store, { lastFullAt: startedAt, lastSyncAt: startedAt });
      })
      .catch((e: unknown) => {
        if (run === runRef.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (run === runRef.current) setActivity(null);
      });
  }, [persist]);

  const refresh = useCallback(() => {
    const meta = syncRef.current;
    if (!meta || storeRef.current.tickets.size === 0) {
      fullReload();
      return;
    }
    runRef.current += 1;
    const run = runRef.current;
    const startedAt = Date.now();
    const store = storeRef.current;
    setError(null);
    setProgress(IDLE);
    setActivity({ mode: 'sync', since: meta.lastSyncAt });
    syncStore(spaces, store, meta.lastSyncAt - SYNC_OVERLAP_MS, (_s, p) => {
      if (run !== runRef.current) return;
      setProgress(p);
      setVersion(v => v + 1);
    })
      .then(result => {
        if (run !== runRef.current) return;
        setVersion(v => v + 1);
        setLoadedAt(Date.now());
        setSyncedAt(startedAt);
        setSummary({ text: updateSummaryText(result), at: Date.now() });
        persist(store, { lastFullAt: meta.lastFullAt, lastSyncAt: startedAt });
      })
      .catch((e: unknown) => {
        if (run === runRef.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (run === runRef.current) setActivity(null);
      });
  }, [fullReload, persist]);

  // On open: show the cached snapshot at once, then sync it (or reload fully when it is stale).
  useEffect(() => {
    let cancelled = false;
    const open = async (): Promise<void> => {
      const kv = kvRef.current;
      if (kv) {
        try {
          const me = await spaces.users.me();
          const cached = await loadCache(kv, me.workspaceId);
          if (cancelled) return;
          setOpening(false);
          if (cached) {
            storeRef.current = cached.store;
            syncRef.current = { lastFullAt: cached.meta.lastFullAt, lastSyncAt: cached.meta.lastSyncAt };
            setCacheState('cached');
            setSyncedAt(cached.meta.lastSyncAt);
            setLoadedAt(cached.meta.savedAt);
            setVersion(v => v + 1);
            if (Date.now() - cached.meta.lastFullAt > FULL_RELOAD_AFTER_MS) fullReload();
            else refresh();
            return;
          }
        } catch {
          // Unreadable cache: fall through to a full load.
        }
      }
      if (cancelled) return;
      setOpening(false);
      fullReload();
    };
    void open();
    return () => {
      cancelled = true;
    };
  }, [fullReload, refresh]);

  const resolveRef = useRef(0);
  const resolveParents = useCallback((mid: string) => {
    resolveRef.current += 1;
    const lookup = resolveRef.current;
    const store = storeRef.current;
    const ids = ticketIdsForMid(store, mid);
    setResolvingParents(true);
    expandUp(spaces, store, ids)
      .then(() => hydrateLookups(spaces, store))
      .catch(() => {
        // Parents are extra context; the merchant's own tickets are already shown.
      })
      .finally(() => {
        // Only the latest lookup clears the flag. A sync mutates the same store, so the result
        // still applies; a full load that replaced the store drops it (App looks up again).
        if (lookup === resolveRef.current) setResolvingParents(false);
        if (store === storeRef.current) setVersion(v => v + 1);
      });
  }, []);

  const store = storeRef.current;
  return {
    store,
    version,
    lookups: store.lookups,
    progress,
    loading: loadedAt === null && error === null,
    busy: activity !== null,
    activity,
    opening,
    summary,
    syncedAt,
    loadedAt,
    cacheState,
    error,
    warnings: store.warnings,
    resolvingParents,
    refresh,
    fullReload,
    resolveParents,
  };
}
