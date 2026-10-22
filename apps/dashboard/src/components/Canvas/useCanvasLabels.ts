import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { canvasLabelsApi, type CanvasLabelsByCanvasId } from '../../api/canvasLabelsApi';
import type { Canvas } from './Canvas.types';

type CanvasLabelList = NonNullable<Canvas['labels']>;

export type CanvasLabelMap = Record<string, CanvasLabelList>;

const CANVAS_LABELS_CHANGED_EVENT = 'canvas-labels-changed';
export const CANVAS_LABEL_REFRESH_STALE_MS = 10_000;
// GET /canvas/labels takes ids in the query string. 100 UUIDs keep the URL around 3.7KB,
// well under proxy request-line buffers (~8KB) and Node's 16KB header limit, even with
// auth cookies. The server accepts up to MAX_CANVAS_LABEL_BULK_IDS (200), but a 414/431 at
// 200 would blank labels for the whole chunk.
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

const isLoadableCanvasId = (id: string | undefined | null): id is string =>
  Boolean(id) && id !== 'new';

const getCanvasIdKey = (canvasIds: string[]): string =>
  Array.from(new Set(canvasIds.filter(isLoadableCanvasId)))
    .sort()
    .join(',');

// ---------------------------------------------------------------------------
// Shared label store.
//
// Every list and row reads labels through this module-level store, so each canvas id is
// fetched once and requests made in the same tick are coalesced into bulk calls of up to
// CANVAS_LABEL_BULK_CHUNK_SIZE ids. Components read it with useSyncExternalStore, so a
// batch that resolves between render and effects is never missed.
//
// Invalidation is module-level too: a `canvas-labels-changed` event marks the id stale
// even when no list that shows it is mounted, so the next mount re-fetches it instead of
// serving the pre-mutation labels for the rest of the session.
// ---------------------------------------------------------------------------

const labelCache = new Map<string, CanvasLabelList>();
const labelFetchedAt = new Map<string, number>();
const inFlightById = new Map<string, Promise<void>>();
/** Cached but known to be out of date; the next load re-fetches them. */
const invalidatedIds = new Set<string>();
/** Invalidated while a request was in flight; that response may predate the change. */
const refetchAfterFlightIds = new Set<string>();
/** How many mounted hooks/rows show each id; tracked ids are re-fetched on change events. */
const trackedRefCount = new Map<string, number>();
const storeListeners = new Set<() => void>();
let storeVersion = 0;

let pendingBatch: { ids: Set<string>; promise: Promise<void>; resolve: () => void } | null = null;

const emitStoreChange = (): void => {
  storeVersion += 1;
  storeListeners.forEach(listener => listener());
};

const subscribeToLabelStore = (listener: () => void): (() => void) => {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
};

const needsLoad = (canvasId: string): boolean =>
  !labelCache.has(canvasId) || invalidatedIds.has(canvasId);

const invalidateCanvasLabels = (canvasId: string): void => {
  invalidatedIds.add(canvasId);
  if (inFlightById.has(canvasId)) refetchAfterFlightIds.add(canvasId);
};

const trackCanvasIds = (canvasIds: string[]): (() => void) => {
  for (const canvasId of canvasIds) {
    trackedRefCount.set(canvasId, (trackedRefCount.get(canvasId) ?? 0) + 1);
  }
  return () => {
    for (const canvasId of canvasIds) {
      const next = (trackedRefCount.get(canvasId) ?? 0) - 1;
      if (next > 0) trackedRefCount.set(canvasId, next);
      else trackedRefCount.delete(canvasId);
    }
  };
};

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
          // Invalidated mid-flight: keep it invalidated so the refetch below runs.
          if (!refetchAfterFlightIds.has(canvasId)) invalidatedIds.delete(canvasId);
        }
        changed = true;
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

  if (changed) emitStoreChange();

  // Ids invalidated while this batch was in flight: the response may predate the change,
  // so fetch them again before anyone waiting on this batch is told it is done.
  const refetch = ids.filter(canvasId => refetchAfterFlightIds.delete(canvasId));
  if (refetch.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    await loadCanvasLabels(refetch);
  }

  batch.resolve();
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
 * Load labels for `canvasIds` into the shared store. Ids already loaded and not
 * invalidated are skipped. `force` invalidates first, so it always produces a response
 * newer than the call: if a request for the id is already in flight, the id is fetched
 * again once that request finishes. Never rejects.
 */
export function loadCanvasLabels(
  canvasIds: string[],
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const waits: Promise<void>[] = [];
  const toFetch: string[] = [];

  for (const canvasId of new Set(canvasIds)) {
    if (!isLoadableCanvasId(canvasId)) continue;
    if (force) invalidateCanvasLabels(canvasId);
    const inFlight = inFlightById.get(canvasId);
    if (inFlight) {
      waits.push(inFlight);
      continue;
    }
    if (!needsLoad(canvasId)) continue;
    toFetch.push(canvasId);
  }

  if (toFetch.length > 0) {
    const promise = enqueueCanvasLabelFetch(toFetch);
    for (const canvasId of toFetch) inFlightById.set(canvasId, promise);
    waits.push(promise);
  }

  return Promise.all(waits).then(() => undefined);
}

export const getCachedCanvasLabels = (canvasId: string): CanvasLabelList | undefined =>
  labelCache.get(canvasId);

// One listener for the whole app. Ids on screen are re-fetched now; ids not on screen are
// only marked stale and re-fetched when something mounts that shows them.
const handleCanvasLabelsChanged = (event: Event): void => {
  const canvasId = (event as CustomEvent<{ canvasId?: string }>).detail?.canvasId;
  const affected = canvasId ? [canvasId] : Array.from(labelCache.keys());
  for (const id of affected) invalidateCanvasLabels(id);
  const onScreen = affected.filter(id => trackedRefCount.has(id));
  if (onScreen.length > 0) void loadCanvasLabels(onScreen);
};

if (typeof window !== 'undefined') {
  window.addEventListener(CANVAS_LABELS_CHANGED_EVENT, handleCanvasLabelsChanged);
}

/** Test-only: reset the shared label store. */
export const resetCanvasLabelCacheForTests = (): void => {
  labelCache.clear();
  labelFetchedAt.clear();
  inFlightById.clear();
  invalidatedIds.clear();
  refetchAfterFlightIds.clear();
  trackedRefCount.clear();
  pendingBatch = null;
};

/** Test-only: whether `canvasId` is marked stale in the shared store. */
export const isCanvasLabelInvalidatedForTests = (canvasId: string): boolean =>
  invalidatedIds.has(canvasId);

/**
 * Subscribe to the store for `ids` and load the ones that are missing or stale. Returns
 * a map that keeps its identity until a tracked id's labels change.
 */
const useTrackedCanvasLabels = (ids: string[]): CanvasLabelMap => {
  const snapshotRef = useRef<{ version: number; ids: string[]; map: CanvasLabelMap } | null>(null);

  const getSnapshot = useCallback((): CanvasLabelMap => {
    const previous = snapshotRef.current;
    if (previous && previous.ids === ids && previous.version === storeVersion) {
      return previous.map;
    }
    const map: CanvasLabelMap = {};
    let changed = !previous || previous.ids !== ids;
    for (const canvasId of ids) {
      const labels = labelCache.get(canvasId);
      if (labels !== undefined) map[canvasId] = labels;
      if (!changed && previous?.map[canvasId] !== labels) changed = true;
    }
    const result = changed || !previous ? map : previous.map;
    snapshotRef.current = { version: storeVersion, ids, map: result };
    return result;
  }, [ids]);

  const labelsByCanvasId = useSyncExternalStore(subscribeToLabelStore, getSnapshot, getSnapshot);

  useEffect(() => {
    if (ids.length === 0) return;
    const untrack = trackCanvasIds(ids);
    // Fetch only ids never loaded or invalidated since. Labels already loaded stay on
    // screen while the new page's labels load.
    const toLoad = ids.filter(needsLoad);
    if (toLoad.length > 0) void loadCanvasLabels(toLoad);
    return untrack;
  }, [ids]);

  return labelsByCanvasId;
};

export const useCanvasLabelMapResult = (canvasIds: string[]): CanvasLabelMapResult => {
  const canvasIdsKey = useMemo(() => getCanvasIdKey(canvasIds), [canvasIds]);
  const ids = useMemo(() => (canvasIdsKey ? canvasIdsKey.split(',') : []), [canvasIdsKey]);
  const labelsByCanvasId = useTrackedCanvasLabels(ids);

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

  // labelsByCanvasId changes identity whenever a tracked id is loaded, so this re-derives.
  const isLoading = useMemo(
    () => ids.some(canvasId => !labelCache.has(canvasId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, labelsByCanvasId],
  );

  return {
    labelsByCanvasId,
    isLoading,
    refresh,
    refreshIfStale,
  };
};

/**
 * Labels for a single canvas from the shared store, or `undefined` while loading (or when
 * `canvasId` is not loadable). Subscribes, so later refreshes reach the row.
 */
export const useCanvasLabelsForCanvas = (
  canvasId: string | undefined,
): CanvasLabelList | undefined => {
  const ids = useMemo(() => (isLoadableCanvasId(canvasId) ? [canvasId] : []), [canvasId]);
  const labelsByCanvasId = useTrackedCanvasLabels(ids);
  return canvasId ? labelsByCanvasId[canvasId] : undefined;
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
  window.dispatchEvent(new CustomEvent(CANVAS_LABELS_CHANGED_EVENT, { detail: { canvasId } }));
};
