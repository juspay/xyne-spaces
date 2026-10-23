import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { canvasLabelsApi, type CanvasLabelsByCanvasId } from '../../api/canvasLabelsApi';
import type { Canvas } from './Canvas.types';

type CanvasLabelList = NonNullable<Canvas['labels']>;

export type CanvasLabelMap = Record<string, CanvasLabelList>;

const CANVAS_LABELS_CHANGED_EVENT = 'canvas-labels-changed';
export const CANVAS_LABEL_REFRESH_STALE_MS = 10_000;
// GET /canvas/labels takes ids in the query string. 100 UUIDs is ~3.7KB of URL, well
// under proxy request-line limits; 200 (the server maximum) gets close to them.
export const CANVAS_LABEL_BULK_CHUNK_SIZE = 100;

export interface CanvasLabelMapResult {
  labelsByCanvasId: CanvasLabelMap;
  isLoading: boolean;
  refresh: () => void;
  /**
   * Re-fetch labels older than `staleMs`. Pass `visibleCanvasIds` to limit the refresh to
   * the rows on screen; without it every tracked id is checked.
   */
  refreshIfStale: (staleMs?: number, visibleCanvasIds?: string[]) => void;
}

const toCanvasLabelList = (labels: CanvasLabelsByCanvasId[string]): CanvasLabelList =>
  labels.map(label => ({
    id: label.id,
    canvasId: label.canvasId,
    name: label.name,
    createdAt: label.createdAt,
  }));

const isLabelableCanvasId = (canvasId: string | null | undefined): canvasId is string =>
  Boolean(canvasId) && canvasId !== 'new';

const getCanvasIdKey = (canvasIds: string[]): string =>
  Array.from(new Set(canvasIds.filter(isLabelableCanvasId)))
    .sort()
    .join(',');

// ---------------------------------------------------------------------------
// Shared label store.
//
// Every list and row reads labels through this module-level store, so each canvas id is
// fetched once and requests made in the same tick are coalesced into bulk calls of up to
// CANVAS_LABEL_BULK_CHUNK_SIZE ids. Before this, the list refetched every id whenever its
// id set changed (each new page), and each row fetched its own labels while the list's
// call was in flight -- ~1,000 requests per scan for users with many canvases.
//
// Components read it with useSyncExternalStore, and label changes are handled by one
// module-level listener, so an entry is invalidated even when no list showing it is mounted.
// ---------------------------------------------------------------------------

const labelCache = new Map<string, CanvasLabelList>();
const labelFetchedAt = new Map<string, number>();
const inFlightById = new Map<string, Promise<void>>();
// Ids that were force-refreshed while a request for them was already in flight. That
// request may have been sent before the change, so they are fetched again once it settles.
const refetchAfterInFlight = new Map<string, Promise<void>>();
// How many mounted hooks / rows currently show each id.
const trackedCounts = new Map<string, number>();
const storeListeners = new Set<() => void>();
let storeVersion = 0;

let pendingBatch: { ids: Set<string>; promise: Promise<void>; resolve: () => void } | null = null;

const emitStoreChange = (): void => {
  storeVersion += 1;
  storeListeners.forEach(listener => listener());
};

const subscribeToStore = (listener: () => void): (() => void) => {
  ensureLabelsChangedListener();
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
};

const getStoreVersion = (): number => storeVersion;

const flushPendingBatch = async (): Promise<void> => {
  const batch = pendingBatch;
  pendingBatch = null;
  if (!batch) return;

  const ids = Array.from(batch.ids);
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += CANVAS_LABEL_BULK_CHUNK_SIZE) {
    chunks.push(ids.slice(index, index + CANVAS_LABEL_BULK_CHUNK_SIZE));
  }

  let changed = false;
  await Promise.allSettled(
    chunks.map(async chunk => {
      try {
        const labelsByCanvasId = await canvasLabelsApi.getCanvasLabels(chunk);
        const now = Date.now();
        for (const canvasId of chunk) {
          labelCache.set(canvasId, toCanvasLabelList(labelsByCanvasId[canvasId] ?? []));
          labelFetchedAt.set(canvasId, now);
          changed = true;
        }
      } catch {
        // Keep whatever we had; a canvas never fetched shows no labels and is retried on
        // the next stale refresh (fetchedAt stays 0).
        for (const canvasId of chunk) {
          if (!labelCache.has(canvasId)) {
            labelCache.set(canvasId, []);
            changed = true;
          }
        }
      } finally {
        for (const canvasId of chunk) inFlightById.delete(canvasId);
      }
    }),
  );

  batch.resolve();
  if (changed) emitStoreChange();
};

const enqueueCanvasLabelFetch = (canvasIds: string[]): Promise<void> => {
  if (!pendingBatch) {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>(done => {
      resolve = done;
    });
    pendingBatch = { ids: new Set(), promise, resolve };
    setTimeout(() => {
      void flushPendingBatch();
    }, 0);
  }
  for (const canvasId of canvasIds) pendingBatch.ids.add(canvasId);
  return pendingBatch.promise;
};

/**
 * Load labels for `canvasIds` into the shared store. Ids already cached (unless `force`)
 * or already in flight are not requested again. With `force`, an id that is in flight is
 * fetched once more after that request settles, so a refresh after a label mutation never
 * settles on a response sent before the mutation. Never rejects.
 */
export const loadCanvasLabels = (
  canvasIds: string[],
  { force = false }: { force?: boolean } = {},
): Promise<void> => {
  const waits: Promise<void>[] = [];
  const toFetch: string[] = [];

  for (const canvasId of new Set(canvasIds)) {
    if (!isLabelableCanvasId(canvasId)) continue;
    const inFlight = inFlightById.get(canvasId);
    if (inFlight) {
      if (!force) {
        waits.push(inFlight);
        continue;
      }
      let refetch = refetchAfterInFlight.get(canvasId);
      if (!refetch) {
        refetch = inFlight.then(() => {
          refetchAfterInFlight.delete(canvasId);
          return loadCanvasLabels([canvasId], { force: true });
        });
        refetchAfterInFlight.set(canvasId, refetch);
      }
      waits.push(refetch);
      continue;
    }
    if (!force && labelCache.has(canvasId)) continue;
    toFetch.push(canvasId);
  }

  if (toFetch.length > 0) {
    const promise = enqueueCanvasLabelFetch(toFetch);
    for (const canvasId of toFetch) inFlightById.set(canvasId, promise);
    waits.push(promise);
  }

  return Promise.all(waits).then(() => undefined);
};

export const getCachedCanvasLabels = (canvasId: string): CanvasLabelList | undefined =>
  labelCache.get(canvasId);

/**
 * A label change for `canvasId` (or for every canvas when omitted). Ids shown by a mounted
 * list or row are re-fetched; the rest are dropped so the next mount fetches them fresh.
 */
const invalidateCanvasLabels = (canvasId?: string): void => {
  const ids = canvasId ? [canvasId] : Array.from(labelCache.keys());
  const toRefetch: string[] = [];
  let dropped = false;
  for (const id of ids) {
    if ((trackedCounts.get(id) ?? 0) > 0) {
      toRefetch.push(id);
    } else if (labelCache.delete(id)) {
      labelFetchedAt.delete(id);
      dropped = true;
    }
  }
  if (dropped) emitStoreChange();
  if (toRefetch.length > 0) void loadCanvasLabels(toRefetch, { force: true });
};

let isLabelsChangedListenerInstalled = false;
const ensureLabelsChangedListener = (): void => {
  if (isLabelsChangedListenerInstalled || typeof window === 'undefined') return;
  isLabelsChangedListenerInstalled = true;
  window.addEventListener(CANVAS_LABELS_CHANGED_EVENT, (event: Event) => {
    invalidateCanvasLabels((event as CustomEvent<{ canvasId?: string }>).detail?.canvasId);
  });
};

const trackCanvasIds = (ids: string[]): (() => void) => {
  for (const id of ids) trackedCounts.set(id, (trackedCounts.get(id) ?? 0) + 1);
  return () => {
    for (const id of ids) {
      const next = (trackedCounts.get(id) ?? 1) - 1;
      if (next <= 0) trackedCounts.delete(id);
      else trackedCounts.set(id, next);
    }
  };
};

/** Test-only: reset the shared label store. */
export const resetCanvasLabelCacheForTests = (): void => {
  labelCache.clear();
  labelFetchedAt.clear();
  inFlightById.clear();
  refetchAfterInFlight.clear();
  trackedCounts.clear();
  pendingBatch = null;
};

/** Test-only: apply a label-change event without a DOM. */
export const invalidateCanvasLabelsForTests = invalidateCanvasLabels;
/** Test-only: mark ids as shown by a mounted component. */
export const trackCanvasIdsForTests = trackCanvasIds;

export const useCanvasLabelMapResult = (canvasIds: string[]): CanvasLabelMapResult => {
  const canvasIdsKey = useMemo(() => getCanvasIdKey(canvasIds), [canvasIds]);
  const ids = useMemo(() => (canvasIdsKey ? canvasIdsKey.split(',') : []), [canvasIdsKey]);
  const version = useSyncExternalStore(subscribeToStore, getStoreVersion, getStoreVersion);

  useEffect(() => (ids.length > 0 ? trackCanvasIds(ids) : undefined), [ids]);

  // Fetch only ids that are not in the store. Labels already loaded stay on screen while
  // the new page's labels load. Runs again when an untracked entry is dropped.
  useEffect(() => {
    const missing = ids.filter(canvasId => !labelCache.has(canvasId));
    if (missing.length > 0) void loadCanvasLabels(missing);
  }, [ids, version]);

  const refresh = useCallback((): void => {
    if (ids.length === 0) return;
    void loadCanvasLabels(ids, { force: true });
  }, [ids]);

  const refreshIfStale = useCallback(
    (staleMs = CANVAS_LABEL_REFRESH_STALE_MS, visibleCanvasIds?: string[]): void => {
      if (ids.length === 0) return;
      const tracked = new Set(ids);
      const candidates =
        visibleCanvasIds && visibleCanvasIds.length > 0
          ? visibleCanvasIds.filter(canvasId => tracked.has(canvasId))
          : ids;
      const now = Date.now();
      const stale = candidates.filter(
        canvasId =>
          !inFlightById.has(canvasId) && now - (labelFetchedAt.get(canvasId) ?? 0) >= staleMs,
      );
      if (stale.length === 0) return;
      void loadCanvasLabels(stale, { force: true });
    },
    [ids],
  );

  const labelsByCanvasId = useMemo(() => {
    const mapped: CanvasLabelMap = {};
    for (const canvasId of ids) {
      const labels = labelCache.get(canvasId);
      if (labels !== undefined) mapped[canvasId] = labels;
    }
    return mapped;
    // `version` is the signal that the store changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, version]);

  const isLoading = ids.some(canvasId => !labelCache.has(canvasId));

  return {
    labelsByCanvasId,
    isLoading,
    refresh,
    refreshIfStale,
  };
};

/**
 * Labels for one canvas from the shared store, loading them if needed. Pass `null` to
 * skip (e.g. when the caller already has labels). Re-renders when the entry changes.
 */
export const useStoredCanvasLabels = (canvasId: string | null): CanvasLabelList | undefined => {
  const id = isLabelableCanvasId(canvasId) ? canvasId : null;
  const getSnapshot = useCallback(() => (id ? labelCache.get(id) : undefined), [id]);
  const labels = useSyncExternalStore(subscribeToStore, getSnapshot, getSnapshot);

  useEffect(() => (id ? trackCanvasIds([id]) : undefined), [id]);
  useEffect(() => {
    if (id && labels === undefined) void loadCanvasLabels([id]);
  }, [id, labels]);

  return labels;
};

export const useCanvasLabelMap = (canvasIds: string[]): CanvasLabelMap => {
  const { labelsByCanvasId } = useCanvasLabelMapResult(canvasIds);
  return labelsByCanvasId;
};

export const mergeCanvasRestLabels = (canvas: Canvas, labelsByCanvasId: CanvasLabelMap): Canvas => {
  const labels = labelsByCanvasId[canvas.id];
  if (labels === undefined) {
    return canvas;
  }
  return { ...canvas, labels };
};

export const useCanvasesWithRestLabels = (canvases: Canvas[]): Canvas[] => {
  const canvasIds = useMemo(() => canvases.map(canvas => canvas.id), [canvases]);
  const labelsByCanvasId = useCanvasLabelMap(canvasIds);

  return useMemo(
    () => canvases.map(canvas => mergeCanvasRestLabels(canvas, labelsByCanvasId)),
    [canvases, labelsByCanvasId],
  );
};

export const notifyCanvasLabelsChanged = (canvasId: string): void => {
  if (typeof window === 'undefined') return;
  ensureLabelsChangedListener();
  window.dispatchEvent(new CustomEvent(CANVAS_LABELS_CHANGED_EVENT, { detail: { canvasId } }));
};
