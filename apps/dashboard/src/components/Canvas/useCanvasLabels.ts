import { useEffect, useMemo, useState } from 'react';
import { canvasLabelsApi, type CanvasLabelsByCanvasId } from '../../api/canvasLabelsApi';
import type { Canvas } from './Canvas.types';

type CanvasLabelList = NonNullable<Canvas['labels']>;

export type CanvasLabelMap = Record<string, CanvasLabelList>;

const CANVAS_LABELS_CHANGED_EVENT = 'canvas-labels-changed';
export const CANVAS_LABEL_REFRESH_STALE_MS = 10_000;
const CANVAS_LABEL_BULK_CHUNK_SIZE = 100;

export interface CanvasLabelMapResult {
  labelsByCanvasId: CanvasLabelMap;
  isLoading: boolean;
  refresh: () => void;
  refreshIfStale: (staleMs?: number) => void;
}

const toCanvasLabelMap = (labelsByCanvasId: CanvasLabelsByCanvasId): CanvasLabelMap => {
  const mapped: CanvasLabelMap = {};
  for (const [canvasId, labels] of Object.entries(labelsByCanvasId)) {
    mapped[canvasId] = labels.map(label => ({
      id: label.id,
      canvasId: label.canvasId,
      name: label.name,
      createdAt: label.createdAt,
    }));
  }
  return mapped;
};

const getCanvasIdKey = (canvasIds: string[]): string =>
  Array.from(new Set(canvasIds.filter(Boolean)))
    .sort()
    .join(',');

const fetchCanvasLabelsInChunks = async (canvasIds: string[]): Promise<CanvasLabelsByCanvasId> => {
  const chunks: string[][] = [];
  for (let index = 0; index < canvasIds.length; index += CANVAS_LABEL_BULK_CHUNK_SIZE) {
    chunks.push(canvasIds.slice(index, index + CANVAS_LABEL_BULK_CHUNK_SIZE));
  }

  const results = await Promise.allSettled(
    chunks.map(chunk => canvasLabelsApi.getCanvasLabels(chunk)),
  );
  return results.reduce<CanvasLabelsByCanvasId>(
    (merged, result) =>
      result.status === 'fulfilled' ? { ...merged, ...result.value } : merged,
    Object.fromEntries(canvasIds.map(canvasId => [canvasId, []])),
  );
};

export const useCanvasLabelMapResult = (canvasIds: string[]): CanvasLabelMapResult => {
  const canvasIdsKey = useMemo(() => getCanvasIdKey(canvasIds), [canvasIds]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<{
    key: string;
    labelsByCanvasId: CanvasLabelMap;
    isLoading: boolean;
    fetchedAt: number;
  }>(() => ({
    key: canvasIdsKey,
    labelsByCanvasId: {},
    isLoading: canvasIdsKey.length > 0,
    fetchedAt: 0,
  }));

  useEffect(() => {
    const ids = canvasIdsKey ? canvasIdsKey.split(',') : [];
    if (ids.length === 0) {
      setState({ key: canvasIdsKey, labelsByCanvasId: {}, isLoading: false, fetchedAt: 0 });
      return;
    }

    let cancelled = false;
    setState(previous => ({
      key: canvasIdsKey,
      labelsByCanvasId: previous.key === canvasIdsKey ? previous.labelsByCanvasId : {},
      isLoading: true,
      fetchedAt: previous.key === canvasIdsKey ? previous.fetchedAt : 0,
    }));

    fetchCanvasLabelsInChunks(ids)
      .then(labels => {
        if (!cancelled) {
          setState({
            key: canvasIdsKey,
            labelsByCanvasId: toCanvasLabelMap(labels),
            isLoading: false,
            fetchedAt: Date.now(),
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState(previous => ({
            ...previous,
            isLoading: false,
            fetchedAt: Date.now(),
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canvasIdsKey, refreshToken]);

  useEffect(() => {
    if (!canvasIdsKey || typeof window === 'undefined') return;

    const ids = new Set(canvasIdsKey.split(','));
    const handleCanvasLabelsChanged = (event: Event): void => {
      const canvasId = (event as CustomEvent<{ canvasId?: string }>).detail?.canvasId;
      if (!canvasId || ids.has(canvasId)) {
        setRefreshToken(token => token + 1);
      }
    };

    window.addEventListener(CANVAS_LABELS_CHANGED_EVENT, handleCanvasLabelsChanged);
    return () => {
      window.removeEventListener(CANVAS_LABELS_CHANGED_EVENT, handleCanvasLabelsChanged);
    };
  }, [canvasIdsKey]);

  const refresh = (): void => {
    if (!canvasIdsKey) return;
    setRefreshToken(token => token + 1);
  };

  const refreshIfStale = (staleMs = CANVAS_LABEL_REFRESH_STALE_MS): void => {
    if (!canvasIdsKey || state.isLoading) return;
    if (Date.now() - state.fetchedAt < staleMs) return;
    refresh();
  };

  if (state.key !== canvasIdsKey) {
    return {
      labelsByCanvasId: {},
      isLoading: canvasIdsKey.length > 0,
      refresh,
      refreshIfStale,
    };
  }

  return {
    labelsByCanvasId: state.labelsByCanvasId,
    isLoading: state.isLoading,
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
