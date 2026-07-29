import { useState, useRef, useEffect, useCallback, RefObject } from 'react';
import { ZoomState } from '../components/FileViewer/utils';

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
  /** Optional callback for reporting interaction state changes (for carousel coordination) */
  onInteractionStateChange?: ((state: ZoomState) => void) | undefined;
}

interface UseMobileZoomReturn {
  /** Current zoom scale */
  scale: number;
  /** CSS transform origin value */
  transformOrigin: string;
  /** Current pan position X (in local unscaled pixels) */
  panX: number;
  /** Reset zoom to initial state */
  resetZoom: () => void;
  /** Set zoom to a specific scale */
  setScale: (scale: number) => void;
  /** Whether currently zoomed in */
  isZoomed: boolean;
  /** Whether user is actively pinching (touch with 2 fingers) */
  isPinching: boolean;
  /** Whether user is actively panning with one finger */
  isPanning: boolean;
}

/**
 * Hook for mobile pinch-to-zoom functionality with single-touch pan support.
 * CAROUSEL COORDINATION:
 * ---------------------------------------------------------------------------
 * When the user tries to pan past a boundary, we DON'T call `preventDefault()`,
 * allowing the touch event to propagate to the carousel for swipe navigation.
 * We also report `isAtLeftEdge` / `isAtRightEdge` via `onInteractionStateChange`
 * so the carousel can decide whether to change slides.
 */
export function useMobileZoom(options: UseMobileZoomOptions): UseMobileZoomReturn {
  const {
    minScale = 1,
    maxScale = 5,
    enabled = true,
    containerRef,
    targetRef,
    onInteractionStateChange,
  } = options;

  const [scale, setScaleState] = useState(minScale);
  const [transformOrigin, setTransformOrigin] = useState('50% 50%');
  const [isPinching, setIsPinching] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panX, setPanX] = useState(0);

  // ── Mutable refs mirroring state (avoid stale closures in listeners) ──
  const scaleRef = useRef(minScale);
  const panXRef = useRef(0);

  // ── Gesture tracking refs ──
  /** Stores pinch start state: initial finger distance and scale */
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);
  /**
   * Stores pan start state:
   *   startX      = screen X where finger touched down
   *   startPanX   = panX value at touch-start
   *   maxPan      = maximum panX allowed during THIS gesture (computed from visual rect)
   *   minPan      = minimum panX allowed during THIS gesture (computed from visual rect)
   *   containerWidth = cached container rect width (avoids getBoundingClientRect in touchmove)
   */
  const panStartRef = useRef<{
    startX: number;
    startPanX: number;
    maxPan: number;
    minPan: number;
    containerWidth: number;
  } | null>(null);

  const onInteractionStateChangeRef = useRef(onInteractionStateChange);
  useEffect(() => {
    onInteractionStateChangeRef.current = onInteractionStateChange;
  }, [onInteractionStateChange]);

  // ── Report zoom/pan state to parent (for carousel swipe decisions) ──
  const reportState = useCallback(() => {
    const cb = onInteractionStateChangeRef.current;
    if (!cb) return;

    const img = targetRef?.current;
    const container = containerRef.current;
    // No image or container → report as "at edges" so carousel can swipe
    if (!img || !container) {
      cb({ scale: scaleRef.current, isAtLeftEdge: true, isAtRightEdge: true });
      return;
    }

    // Not zoomed → report as "at edges" so carousel can swipe freely
    if (scaleRef.current <= minScale) {
      cb({ scale: scaleRef.current, isAtLeftEdge: true, isAtRightEdge: true });
      return;
    }

    // Measure actual visual position (handles any transform-origin, padding, etc.)
    const imgRect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    cb({
      scale: scaleRef.current,
      isAtLeftEdge: imgRect.left >= containerRect.left - 2,
      isAtRightEdge: imgRect.right <= containerRect.right + 2,
    });
  }, [targetRef, containerRef, minScale]);

  /**
   * Fast edge-detection used exclusively in the pan touchmove hot path.
   * Derives left/right boundary state analytically from the pre-computed pan
   * limits in `panStartRef`
   */
  const reportStateDuringPan = useCallback((currentPanX: number) => {
    const cb = onInteractionStateChangeRef.current;
    if (!cb || !panStartRef.current) return;
    const { minPan, maxPan } = panStartRef.current;
    cb({
      scale: scaleRef.current,
      isAtLeftEdge: currentPanX >= maxPan - 1,
      isAtRightEdge: currentPanX <= minPan + 1,
    });
  }, []);

  const resetZoom = useCallback(() => {
    scaleRef.current = minScale;
    setScaleState(minScale);
    setPanX(0);
    panXRef.current = 0;
    setTransformOrigin('50% 50%');
    pinchRef.current = null;
    panStartRef.current = null;
    setIsPinching(false);
    setIsPanning(false);
    reportState();
  }, [minScale, reportState]);

  const setScale = useCallback(
    (newScale: number) => {
      const clamped = Math.min(Math.max(newScale, minScale), maxScale);
      scaleRef.current = clamped;
      setScaleState(clamped);
      reportState();
    },
    [minScale, maxScale, reportState],
  );

  // ═══════════════════════════════════════════════════════════════
  // Touch & Wheel Event Listeners
  // ═══════════════════════════════════════════════════════════════
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
        panStartRef.current = null;

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
      } else if (e.touches.length === 1 && scaleRef.current > minScale) {
        // ── ONE-FINGER PAN (only when zoomed in) ──
        const touch = e.touches[0];
        if (!touch) return;

        const img = targetRef?.current;
        const container = containerRef.current;
        if (!img || !container) return;

        // Cache rects once at pan start — never read again during touchmove
        const imgRect = img.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const currentPan = panXRef.current;
        const visualGapLeft = containerRect.left - imgRect.left;
        const visualGapRight = imgRect.right - containerRect.right;

        const localRoomRight = visualGapLeft;
        const localRoomLeft = -visualGapRight;

        panStartRef.current = {
          startX: touch.clientX,
          startPanX: currentPan,
          maxPan: currentPan + localRoomRight,
          minPan: currentPan + localRoomLeft,
          containerWidth: containerRect.width,
        };

        setIsPanning(true);
        pinchRef.current = null;
      } else {
        // Single finger at normal zoom — clear all gesture states
        panStartRef.current = null;
        pinchRef.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length === 2 && pinchRef.current) {
        // ── PINCH ZOOM ──
        const newDist = getTouchDistance(e.touches);
        if (newDist === null) return;

        e.preventDefault(); // Block carousel swipe while zooming

        const ratio = newDist / pinchRef.current.startDist;
        const newScale = Math.min(
          Math.max(pinchRef.current.startScale * ratio, minScale),
          maxScale,
        );

        scaleRef.current = newScale;
        setScaleState(newScale);
        // reportState intentionally skipped during pinch — user is zooming, not swiping,
        // so carousel coordination is irrelevant until the gesture ends.
      } else if (e.touches.length === 1 && panStartRef.current && scaleRef.current > minScale) {
        // ── SINGLE-FINGER PAN ──
        const touch = e.touches[0];
        if (!touch) return;
        const dx = touch.clientX - panStartRef.current.startX;

        const attemptedPanX = panStartRef.current.startPanX + dx;

        // Rubber-band resistance factor: 1.0 = no resistance, 0.0 = fully stuck
        const RUBBER = 0.35;

        // Clamp with rubber-band resistance near edges
        const { minPan, maxPan } = panStartRef.current;
        let newPanX = attemptedPanX;

        if (newPanX > maxPan) {
          newPanX = maxPan + (newPanX - maxPan) * RUBBER;
        } else if (newPanX < minPan) {
          newPanX = minPan + (newPanX - minPan) * RUBBER;
        }

        // If user is trying to drag PAST the boundary, let the event
        // propagate so the carousel can handle it as a swipe gesture.
        const wouldPanPastBoundary = newPanX !== attemptedPanX;
        const targetEl = targetRef?.current;
        const imgWidth = targetEl ? targetEl.offsetWidth * scaleRef.current : 0;
        const containerWidth = panStartRef.current.containerWidth;
        const imageFitsInContainer = imgWidth <= containerWidth + 2;

        if (!wouldPanPastBoundary && !imageFitsInContainer) {
          e.preventDefault();
        }

        if (newPanX !== panXRef.current) {
          panXRef.current = newPanX;
          setPanX(newPanX);
        }
        // Use pan-limit-based edge detection — no getBoundingClientRect in this hot path
        reportStateDuringPan(newPanX);
      }
    };

    const onTouchEnd = (e: TouchEvent): void => {
      if (e.touches.length < 2) {
        pinchRef.current = null;
        setIsPinching(false);
      }
      if (e.touches.length === 0) {
        panStartRef.current = null;
        setIsPanning(false);

        // Snap back to hard boundary if rubber-banded past edge
        const currentPan = panXRef.current;
        if (scaleRef.current > minScale) {
          const img = targetRef?.current;
          const container = containerRef.current;
          if (img && container) {
            const imgRect = img.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const visualGapLeft = containerRect.left - imgRect.left;
            const visualGapRight = imgRect.right - containerRect.right;
            const currentScale = scaleRef.current;

            const localRoomRight = visualGapLeft / currentScale;
            const localRoomLeft = -visualGapRight / currentScale;

            const maxPan = currentPan + localRoomRight;
            const minPan = currentPan + localRoomLeft;

            if (currentPan > maxPan || currentPan < minPan) {
              const snapped = Math.max(minPan, Math.min(maxPan, currentPan));
              panXRef.current = snapped;
              setPanX(snapped);
              reportState();
            }
          }
        }
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

      const delta = -e.deltaY * 0.01;
      const newScale = Math.min(Math.max(scaleRef.current + delta, minScale), maxScale);

      scaleRef.current = newScale;
      setScaleState(newScale);

      // Reset pan when zooming back to minimum
      if (newScale <= minScale) {
        panXRef.current = 0;
        setPanX(0);
      }

      reportState();
    };

    // Passive:false needed for touchmove/wheel so we can preventDefault
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
  }, [enabled, containerRef, targetRef, minScale, maxScale, reportState, reportStateDuringPan]);

  return {
    scale,
    transformOrigin,
    panX,
    resetZoom,
    setScale,
    isZoomed: scale > minScale,
    isPinching,
    isPanning,
  };
}
