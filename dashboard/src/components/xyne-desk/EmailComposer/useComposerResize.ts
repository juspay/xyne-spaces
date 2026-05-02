import { useEffect, useRef, useState } from 'react';

interface UseComposerResizeOptions {
  /** Resize is allowed only when this is true (e.g. composer expanded, not sending). */
  enabled: boolean;
  /**
   * Use the taller minimum height (e.g. when an AI panel or rephrase prompt
   * is open) so neither the body nor the side panel collapses to an
   * unusable size.
   */
  useTallMinHeight: boolean;
  initialHeight?: number;
  defaultMinHeight?: number;
  tallMinHeight?: number;
  maxHeight?: number;
}

interface UseComposerResizeReturn {
  composerHeight: number;
  setComposerHeight: (next: number | ((current: number) => number)) => void;
  isResizing: boolean;
  startResize: (clientY: number) => void;
  handleTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void;
}

/**
 * Owns the composer's drag-to-resize behavior — height state, ref-tracked
 * starting positions, mouse + touch listeners, and the `user-select: none`
 * cursor lock during the drag. The composer body just calls
 * `startResize(e.clientY)` from its grab handle and reads `composerHeight`.
 */
export const useComposerResize = ({
  enabled,
  useTallMinHeight,
  initialHeight = 320,
  defaultMinHeight = 260,
  tallMinHeight = 440,
  maxHeight = 760,
}: UseComposerResizeOptions): UseComposerResizeReturn => {
  const [composerHeight, setComposerHeightState] = useState<number>(initialHeight);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startYRef = useRef<number>(0);
  const startHeightRef = useRef<number>(initialHeight);

  const setComposerHeight: UseComposerResizeReturn['setComposerHeight'] = next => {
    setComposerHeightState(prev => (typeof next === 'function' ? next(prev) : next));
  };

  const startResize = (clientY: number): void => {
    if (!enabled) return;
    startYRef.current = clientY;
    startHeightRef.current = composerHeight;
    setIsResizing(true);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>): void => {
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    startResize(touch.clientY);
  };

  useEffect(() => {
    if (!isResizing) return undefined;
    const minHeight = useTallMinHeight ? tallMinHeight : defaultMinHeight;

    const onPointerMove = (clientY: number): void => {
      const deltaY = startYRef.current - clientY;
      const next = Math.min(maxHeight, Math.max(minHeight, startHeightRef.current + deltaY));
      setComposerHeightState(next);
    };

    const onMouseMove = (e: MouseEvent): void => onPointerMove(e.clientY);
    const onTouchMove = (e: TouchEvent): void => {
      const touch = e.touches[0];
      if (!touch) return;
      e.preventDefault();
      onPointerMove(touch.clientY);
    };
    const stop = (): void => setIsResizing(false);

    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', stop);

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stop);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', stop);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isResizing, useTallMinHeight, defaultMinHeight, tallMinHeight, maxHeight]);

  return {
    composerHeight,
    setComposerHeight,
    isResizing,
    startResize,
    handleTouchStart,
  };
};
