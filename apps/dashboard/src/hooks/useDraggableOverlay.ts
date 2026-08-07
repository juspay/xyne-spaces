import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent,
  type RefObject,
  type TouchEvent,
} from 'react';

interface DragState {
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
  containerWidth: number;
  containerHeight: number;
}

export interface OverlayPosition {
  x: number;
  y: number;
}

interface DraggableOverlayResult {
  position: OverlayPosition;
  isDragging: boolean;
  hasDragged: boolean;
  handleMouseDown: (event: MouseEvent) => void;
  handleTouchStart: (event: TouchEvent) => void;
}

/** Read the current viewport dimensions (excluding scrollbars). */
const getViewportSize = (): { width: number; height: number } => ({
  width: document.documentElement.clientWidth,
  height: document.documentElement.clientHeight,
});

/**
 * Makes a fixed overlay draggable by a dedicated mouse/touch handle.
 * Positions are measured from the viewport's left and bottom edges.
 *
 * @example
 * const ref = useRef<HTMLDivElement>(null);
 * const { position, handleMouseDown, handleTouchStart } = useDraggableOverlay(ref, { x: 64, y: 32 });
 *
 * return (
 *   <div ref={ref} style={{ position: 'fixed', left: position.x, bottom: position.y }}>
 *     <button onMouseDown={handleMouseDown} onTouchStart={handleTouchStart}>Drag</button>
 *   </div>
 * );
 */
export const useDraggableOverlay = (
  containerRef: RefObject<HTMLElement | null>,
  initialPosition: OverlayPosition,
): DraggableOverlayResult => {
  const [position, setPosition] = useState<OverlayPosition>(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);

  /** Capture the container's rendered position and dimensions when a drag begins. */
  const startDrag = useCallback(
    (clientX: number, clientY: number): void => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const viewport = getViewportSize();
      const renderedPosition = {
        x: rect.left,
        y: viewport.height - rect.bottom,
      };

      setPosition(renderedPosition);
      setIsDragging(true);
      setDragState({
        startX: clientX,
        startY: clientY,
        initialX: renderedPosition.x,
        initialY: renderedPosition.y,
        containerWidth: rect.width,
        containerHeight: rect.height,
      });
    },
    [containerRef],
  );

  const handleMouseDown = useCallback(
    (event: MouseEvent): void => {
      event.preventDefault();
      startDrag(event.clientX, event.clientY);
    },
    [startDrag],
  );

  const handleTouchStart = useCallback(
    (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (touch) startDrag(touch.clientX, touch.clientY);
    },
    [startDrag],
  );

  /** Attach window-level move/end listeners while a drag is in progress. */
  useEffect(() => {
    if (!isDragging || !dragState) return;

    const handleMove = (clientX: number, clientY: number): void => {
      const dx = clientX - dragState.startX;
      const dy = clientY - dragState.startY;
      const viewport = getViewportSize();

      setHasDragged(true);
      setPosition({
        x: Math.max(
          0,
          Math.min(viewport.width - dragState.containerWidth, dragState.initialX + dx),
        ),
        y: Math.max(
          0,
          Math.min(viewport.height - dragState.containerHeight, dragState.initialY - dy),
        ),
      });
    };

    const handleMouseMove = (event: globalThis.MouseEvent): void => {
      handleMove(event.clientX, event.clientY);
    };
    const handleTouchMove = (event: globalThis.TouchEvent): void => {
      const touch = event.touches[0];
      if (touch) {
        event.preventDefault();
        handleMove(touch.clientX, touch.clientY);
      }
    };
    const endDrag = (): void => {
      setIsDragging(false);
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', endDrag);
    window.addEventListener('touchcancel', endDrag);

    return (): void => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', endDrag);
      window.removeEventListener('touchcancel', endDrag);
    };
  }, [containerRef, dragState, isDragging]);

  /** Keep the overlay within viewport bounds on resize or container size change. */
  useEffect(() => {
    const clampToViewport = (): void => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const viewport = getViewportSize();
      setPosition(current => ({
        x: Math.max(0, Math.min(viewport.width - rect.width, current.x)),
        y: Math.max(0, Math.min(viewport.height - rect.height, current.y)),
      }));
    };

    const container = containerRef.current;
    const resizeObserver =
      container && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(clampToViewport)
        : null;
    if (container) resizeObserver?.observe(container);
    clampToViewport();
    window.addEventListener('resize', clampToViewport);

    return (): void => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', clampToViewport);
    };
  }, [containerRef]);

  return { position, isDragging, hasDragged, handleMouseDown, handleTouchStart };
};
