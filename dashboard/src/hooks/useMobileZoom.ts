import { useState, useRef, useEffect, useCallback, RefObject } from 'react';

interface UseMobileZoomOptions {
  /** Minimum zoom scale (default: 1) */
  minScale?: number;
  /** Maximum zoom scale (default: 5) */
  maxScale?: number;
  /** Whether zoom is enabled */
  enabled?: boolean;
  /** Element ref to attach touch listeners to */
  containerRef: RefObject<HTMLElement | null>;
  /** Optional element ref for calculating transform origin */
  targetRef?: RefObject<HTMLElement | null>;
}

interface UseMobileZoomReturn {
  /** Current zoom scale */
  scale: number;
  /** CSS transform origin value */
  transformOrigin: string;
  /** Reset zoom to initial state */
  resetZoom: () => void;
  /** Set zoom to a specific scale */
  setScale: (scale: number) => void;
  /** Whether currently zoomed in */
  isZoomed: boolean;
  /** Whether user is actively pinching (touch with 2 fingers) */
  isPinching: boolean;
}

/**
 * Hook for mobile pinch-to-zoom functionality
 * Handles touch events for pinch gestures and wheel events for trackpad pinch
 * Prevents default to stop carousel swipe when zooming
 */
export function useMobileZoom(options: UseMobileZoomOptions): UseMobileZoomReturn {
  const { minScale = 1, maxScale = 5, enabled = true, containerRef, targetRef } = options;

  const [scale, setScaleState] = useState(minScale);
  const [transformOrigin, setTransformOrigin] = useState('50% 50%');
  const [isPinching, setIsPinching] = useState(false);

  // Mutable ref mirroring scale to avoid stale closures in listeners
  const scaleRef = useRef(minScale);
  // Records finger distance and scale when second finger lands
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);

  const resetZoom = useCallback(() => {
    scaleRef.current = minScale;
    setScaleState(minScale);
    setTransformOrigin('50% 50%');
    pinchRef.current = null;
    setIsPinching(false);
  }, [minScale]);

  const setScale = useCallback(
    (newScale: number) => {
      const clamped = Math.min(Math.max(newScale, minScale), maxScale);
      scaleRef.current = clamped;
      setScaleState(clamped);
    },
    [minScale, maxScale],
  );

  // Update scaleRef when state changes externally
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Touch and wheel event handlers for zoom
  useEffect(() => {
    if (!enabled) return;

    const el = containerRef.current;
    if (!el) return;

    const getTouchDistance = (touches: TouchList): number | null => {
      const t0 = touches[0];
      const t1 = touches[1];
      if (!t0 || !t1) return null;
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length === 2) {
        const dist = getTouchDistance(e.touches);
        if (dist === null) return;

        setIsPinching(true);
        pinchRef.current = {
          startDist: dist,
          startScale: scaleRef.current,
        };

        // Set transform origin to midpoint between fingers
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const targetElement = targetRef?.current || el;

        if (t0 && t1 && targetElement) {
          const rect = targetElement.getBoundingClientRect();
          const midX = (t0.clientX + t1.clientX) / 2;
          const midY = (t0.clientY + t1.clientY) / 2;
          const originX = ((midX - rect.left) / rect.width) * 100;
          const originY = ((midY - rect.top) / rect.height) * 100;
          setTransformOrigin(`${originX}% ${originY}%`);
        }
      } else {
        // Single finger - clear pinch state
        pinchRef.current = null;
        setIsPinching(false);
      }
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2 || !pinchRef.current) return;

      const newDist = getTouchDistance(e.touches);
      if (newDist === null) return;

      // Prevent carousel swipe when zooming
      e.preventDefault();

      const ratio = newDist / pinchRef.current.startDist;
      const newScale = Math.min(Math.max(pinchRef.current.startScale * ratio, minScale), maxScale);

      scaleRef.current = newScale;
      setScaleState(newScale);
    };

    const onTouchEnd = (e: TouchEvent): void => {
      if (e.touches.length < 2) {
        pinchRef.current = null;
        setIsPinching(false);
      }
    };

    // Trackpad pinch support (wheel with ctrlKey)
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;

      e.preventDefault();

      const targetElement = targetRef?.current || el;
      if (targetElement) {
        const rect = targetElement.getBoundingClientRect();
        const originX = ((e.clientX - rect.left) / rect.width) * 100;
        const originY = ((e.clientY - rect.top) / rect.height) * 100;
        setTransformOrigin(`${originX}% ${originY}%`);
      }

      // deltaY is negative when pinching out (zoom-in), positive when pinching in (zoom-out)
      const delta = -e.deltaY * 0.01;
      const newScale = Math.min(Math.max(scaleRef.current + delta, minScale), maxScale);

      scaleRef.current = newScale;
      setScaleState(newScale);
    };

    // Add listeners with appropriate passive settings
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, [enabled, containerRef, targetRef, minScale, maxScale]);

  return {
    scale,
    transformOrigin,
    resetZoom,
    setScale,
    isZoomed: scale > minScale,
    isPinching,
  };
}
