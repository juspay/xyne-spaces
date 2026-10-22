import { useCallback, useEffect, useMemo, useState } from 'react';
import { canvasLabelsApi, type CanvasLabelsByCanvasId } from '../../api/canvasLabelsApi';
import type { Canvas } from './Canvas.types';

type CanvasLabelList = NonNullable<Canvas['labels']>;

export type CanvasLabelMap = Record<string, CanvasLabelList>;

const CANVAS_LABELS_CHANGED_EVENT = 'canvas-labels-changed';
export const CANVAS_LABEL_REFRESH_STALE_MS = 10_000;
// Matches MAX_CANVAS_LABEL_BULK_IDS on GET /canvas/labels.
export const CANVAS_LABEL_BULK_CHUNK_SIZE = 200;

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

const getCanvasIdKey = (canvasIds: string[]): string =>
  Array.from(new Set(canvasIds.filter(id => Boolean(id) && id !== 'new')))
    .sort()
    .join(',');

// ---------------------------------------------------------------------------
// Shared label store.
//
// Every list and row reads labels through this module-level cache, so each canvas id is
// fetched once and requests made in the same tick are coalesced into bulk calls of up to
// CANVAS_LABEL_BULK_CHUNK_SIZE ids. Before this, the list refetched every id whenever its
// id set changed (each new page), and each row fetched its own labels while the list's
// call was in flight -- ~1,000 requests per scan for users with many canvases.
// ---------------------------------------------------------------------------

const labelCache = new Map<string, CanvasLabelList>();
const labelFetchedAt = new Map<string, number>();
const inFlightById = new Map<string, Promise<void>>();
const cacheListeners = new Set<(updatedIds: Set<string>) => void>();

let pendingBatch: { ids: Set<string>; promise: Promise<void>; resolve: () => void } | null = null;

const notifyCacheListeners = (updatedIds: Set<string>): void => {
  if (updatedIds.size === 0) return;
  cacheListeners.forEach(listener => listener(updatedIds));
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

  const updatedIds = new Set<string>();
  await Promise.allSettled(
    chunks.map(async chunk => {
      try {
        const labelsByCanvasId = await canvasLabelsApi.getCanvasLabels(chunk);
        const now = Date.now();
        for (const canvasId of chunk) {
          labelCache.set(canvasId, toCanvasLabelList(labelsByCanvasId[canvasId] ?? []));
          labelFetchedAt.set(canvasId, now);
          updatedIds.add(canvasId);
        }
      } catch {
        // Keep whatever we had; a canvas never fetched shows no labels and is retried on
        // the next stale refresh (fetchedAt stays 0).
        for (const canvasId of chunk) {
          if (!labelCache.has(canvasId)) {
            labelCache.set(canvasId, []);
            updatedIds.add(canvasId);
          }
        }
      } finally {
        for (const canvasId of chunk) inFlightById.delete(canvasId);
      }
    }),
  );

  batch.resolve();
  notifyCacheListeners(updatedIds);
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
 * Load labels for `canvasIds` into the shared cache. Ids already cached (unless `force`)
 * or already in flight are not requested again. Never rejects.
 */
export const loadCanvasLabels = (
  canvasIds: string[],
  { force = false }: { force?: boolean } = {},
): Promise<void> => {
  const waits: Promise<void>[] = [];
  const toFetch: string[] = [];

  for (const canvasId of new Set(canvasIds)) {
    if (!canvasId || canvasId === 'new') continue;
    const inFlight = inFlightById.get(canvasId);
    if (inFlight) {
      waits.push(inFlight);
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

/** Test-only: reset the shared label store. */
export const resetCanvasLabelCacheForTests = (): void => {
  labelCache.clear();
  labelFetchedAt.clear();
  inFlightById.clear();
  pendingBatch = null;
};

export const useCanvasLabelMapResult = (canvasIds: string[]): CanvasLabelMapResult => {
  const canvasIdsKey = useMemo(() => getCanvasIdKey(canvasIds), [canvasIds]);
  const ids = useMemo(() => (canvasIdsKey ? canvasIdsKey.split(',') : []), [canvasIdsKey]);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  // Re-render when any tracked id is (re)loaded, by this hook or anyone else.
  useEffect(() => {
    if (ids.length === 0) return;
    const tracked = new Set(ids);
    const listener = (updatedIds: Set<string>): void => {
      for (const canvasId of updatedIds) {
        if (tracked.has(canvasId)) {
          setCacheVersion(version => version + 1);
          return;
        }
      }
    };
    cacheListeners.add(listener);
    return () => {
      cacheListeners.delete(listener);
    };
  }, [ids]);

  const runLoad = useCallback((idsToLoad: string[], force: boolean): (() => void) => {
    let cancelled = false;
    setPendingCount(count => count + 1);
    void loadCanvasLabels(idsToLoad, { force }).finally(() => {
      if (!cancelled) setPendingCount(count => Math.max(0, count - 1));
    });
    return () => {
      if (cancelled) return;
      cancelled = true;
      setPendingCount(count => Math.max(0, count - 1));
    };
  }, []);

  // Fetch only ids we have never loaded. Labels already loaded stay on screen while the
  // new page's labels load.
  useEffect(() => {
    const missing = ids.filter(canvasId => !labelCache.has(canvasId));
    if (missing.length === 0) return;
    return runLoad(missing, false);
  }, [ids, runLoad]);

  useEffect(() => {
    if (ids.length === 0 || typeof window === 'undefined') return;

    const tracked = new Set(ids);
    const handleCanvasLabelsChanged = (event: Event): void => {
      const canvasId = (event as CustomEvent<{ canvasId?: string }>).detail?.canvasId;
      if (!canvasId) {
        void loadCanvasLabels(ids, { force: true });
        return;
      }
      if (tracked.has(canvasId)) {
        void loadCanvasLabels([canvasId], { force: true });
      }
    };

    window.addEventListener(CANVAS_LABELS_CHANGED_EVENT, handleCanvasLabelsChanged);
    return () => {
      window.removeEventListener(CANVAS_LABELS_CHANGED_EVENT, handleCanvasLabelsChanged);
    };
  }, [ids]);

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
    // cacheVersion is the signal that labelCache changed for one of `ids`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, cacheVersion, pendingCount]);

  const isLoading = ids.some(canvasId => !labelCache.has(canvasId));

  return {
    labelsByCanvasId,
    isLoading,
    refresh,
    refreshIfStale,
  };
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
