import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

type UseMeasureProps = {
  ref?: RefObject<HTMLElement | null>;
  observeResize?: boolean;
};

type UseMeasureReturn = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/**
 * Hook that measures the position and dimensions of an HTML element using getBoundingClientRect().
 *
 * @param ref - React ref object pointing to the HTML element to measure
 * @param observeResize - Optional flag to enable automatic updates when element resizes (default: false)
 *
 * @returns Object containing top, left, right, bottom, width, and height measurements
 *
 * @example
 * // Basic usage - measure element once on mount/ref change
 * const elementRef = useRef<HTMLDivElement>(null);
 * const { width, height, top, left } = useMeasure({ ref: elementRef });
 *
 * @example
 * // With resize observation - automatically update when element size changes
 * const containerRef = useRef<HTMLDivElement>(null);
 * const measurements = useMeasure({ ref: containerRef, observeResize: true });
 *
 * // Use measurements for positioning or responsive behavior
 * const isNarrow = measurements.width < 768;
 *
 * @example
 * // Practical usage in a component
 * function ResponsiveComponent() {
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   const { width, height } = useMeasure({ ref: containerRef, observeResize: true });
 *
 *   return (
 *     <div ref={containerRef}>
 *       <p>Container size: {width}x{height}</p>
 *       {width > 600 ? <WideLayout /> : <NarrowLayout />}
 *     </div>
 *   );
 * }
 *
 * @example
 * // Using position data for tooltips or overlays
 * function TooltipComponent() {
 *   const triggerRef = useRef<HTMLButtonElement>(null);
 *   const { top, left, bottom, height } = useMeasure({ ref: triggerRef });
 *
 *   const tooltipStyle = {
 *     position: 'fixed' as const,
 *     top: bottom + 8, // Position tooltip below the trigger
 *     left: left,
 *   };
 *
 *   return (
 *     <>
 *       <button ref={triggerRef}>Hover me</button>
 *       <div style={tooltipStyle}>Tooltip content</div>
 *     </>
 *   );
 * }
 */
const useMeasure = ({ ref, observeResize = false }: UseMeasureProps): UseMeasureReturn => {
  const [size, setSize] = useState({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  const observedElementRef = useRef<HTMLElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const updateMeasurements = useCallback((): void => {
    if (!ref) {
      setSize({
        top: 0,
        left: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    } else if (ref.current !== null) {
      const rect = ref.current.getBoundingClientRect();
      setSize({
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
    }
  }, [ref]);

  useEffect(() => {
    updateMeasurements();
  }, [updateMeasurements]);

  useEffect(() => {
    if (!observeResize) return;

    if (!ref) {
      window.addEventListener('resize', updateMeasurements);
      return (): void => {
        window.removeEventListener('resize', updateMeasurements);
      };
    }

    if (ref.current === null) return;
    const resizeObserver = new ResizeObserver((): void => {
      updateMeasurements();
    });

    resizeObserver.observe(ref.current);

    return (): void => {
      resizeObserver.disconnect();
    };
  }, [ref, observeResize, updateMeasurements]);

  // Detect when ref.current changes (e.g. conditionally rendered elements)
  // and re-attach the ResizeObserver to the new element
  useEffect(() => {
    const currentElement = ref?.current ?? null;
    if (currentElement === observedElementRef.current) return;
    observedElementRef.current = currentElement;

    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;

    updateMeasurements();

    if (observeResize && currentElement) {
      const resizeObserver = new ResizeObserver((): void => {
        updateMeasurements();
      });
      resizeObserver.observe(currentElement);
      resizeObserverRef.current = resizeObserver;
    }
  });

  return size;
};

export default useMeasure;
