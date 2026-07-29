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
  /**
   * When any recipient field is expanded, treat min-height the same as
   * tallMinHeight so the editor stays usable.
   */
  recipientExpanded?: boolean;
  initialHeight?: number;
  defaultMinHeight?: number;
  tallMinHeight?: number;
  maxHeight?: number;
}

interface UseComposerResizeReturn {
  composerHeight: number;
  setComposerHeight: (next: number | ((current: number) => number)) => void;
  isResizing: boolean;
  handlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  resizeTargetRef: React.RefObject<HTMLDivElement | null>;
  /** Computed minimum height based on current conditions */
  minHeight: number;
}

/**
 * Owns the composer's drag-to-resize behavior — height state, ref-tracked
 * starting positions, and a pointer-captured drag lifecycle so quick drags
 * can't outrun listener setup or get lost over the thread's iframes.
 */
export const COMPOSER_MAX_HEIGHT_PX = 760;

export const useComposerResize = ({
  enabled,
  useTallMinHeight,
  recipientExpanded = false,
  initialHeight = 320,
  defaultMinHeight = 260,
  tallMinHeight = 440,
  maxHeight = 760,
}: UseComposerResizeOptions): UseComposerResizeReturn => {
  const [composerHeight, setComposerHeightState] = useState<number>(initialHeight);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const minHeight = useTallMinHeight || recipientExpanded ? tallMinHeight : defaultMinHeight;
  const startYRef = useRef<number>(0);
  const startHeightRef = useRef<number>(initialHeight);
  const pendingHeightRef = useRef<number>(initialHeight);
  const resizeTargetRef = useRef<HTMLDivElement | null>(null);
  const finishResizeRef = useRef<((commit?: boolean) => void) | null>(null);

  const setComposerHeight: UseComposerResizeReturn['setComposerHeight'] = next => {
    setComposerHeightState(prev => {
      const value = typeof next === 'function' ? next(prev) : next;
      pendingHeightRef.current = value;
      return value;
    });
  };

  useEffect(() => {
    return () => {
      finishResizeRef.current?.(false);
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!enabled || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    finishResizeRef.current?.(true);
    event.preventDefault();

    startYRef.current = event.clientY;
    startHeightRef.current = pendingHeightRef.current;
    setIsResizing(true);

    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const target = resizeTargetRef.current;
    const prevUserSelect = document.body.style.userSelect;
    const prevWillChange = target?.style.willChange ?? '';
    const prevContain = target?.style.contain ?? '';
    let rafId: number | null = null;
    let finished = false;

    if (target) {
      target.style.willChange = 'height';
      target.style.contain = 'layout paint';
    }
    document.body.style.userSelect = 'none';

    const flush = (): void => {
      rafId = null;
      if (target) target.style.height = `${pendingHeightRef.current}px`;
    };

    const finish = (commit = true): void => {
      if (finished) return;
      finished = true;
      finishResizeRef.current = null;

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerCancel);
      handle.removeEventListener('lostpointercapture', onLostPointerCapture);
      window.removeEventListener('blur', onWindowBlur);

      if (handle.isConnected && handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }

      document.body.style.userSelect = prevUserSelect;
      if (target) {
        target.style.willChange = prevWillChange;
        target.style.contain = prevContain;
      }

      if (commit) setComposerHeightState(pendingHeightRef.current);
      setIsResizing(false);
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        finish(true);
        return;
      }

      const deltaY = startYRef.current - e.clientY;
      pendingHeightRef.current = Math.min(
        maxHeight,
        Math.max(minHeight, startHeightRef.current + deltaY),
      );
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (e.pointerId === pointerId) finish(true);
    };
    const onPointerCancel = (e: PointerEvent): void => {
      if (e.pointerId === pointerId) finish(true);
    };
    const onLostPointerCapture = (): void => finish(true);
    const onWindowBlur = (): void => finish(true);

    finishResizeRef.current = finish;
    handle.setPointerCapture(pointerId);
    handle.addEventListener('pointermove', onPointerMove, { passive: true });
    handle.addEventListener('pointerup', onPointerUp, { passive: true });
    handle.addEventListener('pointercancel', onPointerCancel, { passive: true });
    handle.addEventListener('lostpointercapture', onLostPointerCapture);
    window.addEventListener('blur', onWindowBlur);
  };

  return {
    composerHeight,
    setComposerHeight,
    isResizing,
    handlePointerDown,
    resizeTargetRef,
    minHeight,
  };
};
