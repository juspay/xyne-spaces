import { useEffect, useState, useRef, RefObject } from 'react';

interface UseResizablePanelOptions {
  /**
   * The threshold width in pixels at which to consider the panel "wide screen"
   * @default 700
   */
  widthThreshold?: number;
  /**
   * Skips ResizeObserver logic in mobile
   */
  isMobile?: boolean;
}

interface UseResizablePanelReturn {
  /**
   * Whether the panel width is >= widthThreshold
   */
  isWideScreen: boolean;
  /**
   * Ref to attach to the container element being observed
   */
  containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Custom hook for detecting and tracking container width changes using ResizeObserver.
 *
 * This hook observes a container element and determines whether it should be considered
 * "wide screen" based on a configurable width threshold (default 800px).
 *
 * Includes proper cleanup to prevent memory leaks when components unmount.
 *
 * @param options - Configuration options for the hook
 * @returns An object containing isWideScreen state and containerRef
 */

export const useResizablePanel = (
  options: UseResizablePanelOptions = {},
): UseResizablePanelReturn => {
  const { widthThreshold = 700, isMobile = false } = options;

  const [isWideScreen, setIsWideScreen] = useState(!isMobile);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const observeWidth = (): void => {
      if (containerRef.current) {
        const width = containerRef.current.getBoundingClientRect().width;
        setIsWideScreen(width >= widthThreshold);
      }
    };

    // Clean up any existing observer before creating a new one
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    observerRef.current = new ResizeObserver(observeWidth);
    if (containerRef.current) {
      observerRef.current.observe(containerRef.current);
    }

    observeWidth();

    return (): void => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [widthThreshold]);

  return { isWideScreen, containerRef };
};
