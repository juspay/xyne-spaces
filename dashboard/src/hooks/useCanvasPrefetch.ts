import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { canvasPrefetchService } from '../services/Canvas/canvasPrefetchService';
import { logger, Event } from '../utils/logger';

interface CanvasPrefetchItem {
  id: string;
  channelId?: string;
  isCollaborative?: boolean;
  title?: string;
}

interface UseCanvasPrefetchReturn {
  prefetchCanvas: (canvas: CanvasPrefetchItem) => Promise<void>;
  prefetchTopCanvases: (canvases: CanvasPrefetchItem[], count?: number) => Promise<void>;
  handleMouseEnter: (canvas: CanvasPrefetchItem) => void;
  handleMouseLeave: () => void;
}

const HOVER_DELAY_MS = 300;

export function useCanvasPrefetch(): UseCanvasPrefetchReturn {
  const queryClient = useQueryClient();
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prefetchingRef = useRef<Set<string>>(new Set());

  const prefetchCanvas = useCallback(
    async (canvas: CanvasPrefetchItem) => {
      if (canvas.isCollaborative === false) {
        return;
      }

      const prefetchKey = `${canvas.id}-${canvas.channelId || 'default'}`;

      if (
        prefetchingRef.current.has(prefetchKey) ||
        canvasPrefetchService.isPrefetched(canvas.id)
      ) {
        return;
      }

      prefetchingRef.current.add(prefetchKey);
      const startTime = Date.now();
      logger.info(Event.CANVAS_PREFETCH_STARTED, { canvasId: canvas.id });

      try {
        await canvasPrefetchService.prefetchCanvas(queryClient, canvas.id, {
          ...(canvas.channelId ? { channelId: canvas.channelId } : {}),
          ...(canvas.title ? { title: canvas.title } : {}),
        });
        logger.info(Event.CANVAS_PREFETCH_SUCCESS, {
          canvasId: canvas.id,
          latency: Date.now() - startTime,
        });
      } catch (error) {
        logger.error(Event.CANVAS_PREFETCH_FAILED, {
          canvasId: canvas.id,
          error: error instanceof Error ? error.message : 'Unknown error',
          latency: Date.now() - startTime,
        });
      } finally {
        prefetchingRef.current.delete(prefetchKey);
      }
    },
    [queryClient],
  );

  const prefetchTopCanvases = useCallback(
    async (canvases: CanvasPrefetchItem[], count = 3) => {
      const collaborativeCanvases = canvases.filter(c => c.isCollaborative !== false);
      const topCanvases = collaborativeCanvases.slice(0, count);

      await Promise.allSettled(topCanvases.map(canvas => prefetchCanvas(canvas)));
    },
    [prefetchCanvas],
  );

  const handleMouseEnter = useCallback(
    (canvas: CanvasPrefetchItem) => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }

      if (canvasPrefetchService.isPrefetched(canvas.id)) {
        return;
      }

      hoverTimerRef.current = setTimeout(() => {
        void prefetchCanvas(canvas);
      }, HOVER_DELAY_MS);
    },
    [prefetchCanvas],
  );

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return (): void => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  return {
    prefetchCanvas,
    prefetchTopCanvases,
    handleMouseEnter,
    handleMouseLeave,
  };
}
