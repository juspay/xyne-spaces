import { useEffect, RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlatform } from './usePlatform';

export interface UseSwipeBackOptions {
  /**
   * Minimum horizontal distance in pixels to trigger swipe back
   * @default 100
   */
  minSwipeDistance?: number;
  /**
   * Maximum distance from left edge in pixels where swipe can start
   * @default 50
   */
  edgeThreshold?: number;
  /**
   * Whether to enable the swipe back gesture
   * @default true
   */
  enabled?: boolean;
  /**
   * Custom callback to execute instead of default navigation
   * If provided, default navigation will not occur
   */
  onSwipeBack?: () => void;
}

/**
 * Hook to enable right swipe (from left edge) as back navigation on mobile devices
 * Detects swipe gestures starting from the left edge and navigates back in history
 *
 * @param ref - Optional React ref object to limit swipe detection to a specific element
 * @param options - Configuration options for swipe behavior
 *
 * @example
 * // Global swipe back
 * useSwipeBack();
 *
 * @example
 * // Swipe back limited to specific element
 * const containerRef = useRef<HTMLDivElement>(null);
 * useSwipeBack(containerRef);
 *
 * @example
 * // Custom swipe back behavior
 * useSwipeBack(null, {
 *   minSwipeDistance: 150,
 *   onSwipeBack: () => console.log('Swiped back!')
 * });
 */
export const useSwipeBack = (
  ref?: RefObject<HTMLElement> | null,
  options: UseSwipeBackOptions = {},
): void => {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();

  const { minSwipeDistance = 100, edgeThreshold = 50, enabled = true, onSwipeBack } = options;

  useEffect(() => {
    // Only enable on mobile devices and when explicitly enabled
    if (!isMobile || !enabled) {
      return;
    }

    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;

    const handleTouchStart = (event: Event): void => {
      const touchEvent = event as TouchEvent;
      const touch = touchEvent.touches[0];
      if (!touch) return;

      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    };

    const handleTouchMove = (event: Event): void => {
      const touchEvent = event as TouchEvent;
      const touch = touchEvent.touches[0];
      if (!touch) return;

      touchEndX = touch.clientX;
      touchEndY = touch.clientY;
    };

    const handleTouchEnd = (): void => {
      // Check if swipe started from left edge
      if (touchStartX > edgeThreshold) {
        return;
      }

      // Calculate horizontal and vertical distance
      const horizontalDistance = touchEndX - touchStartX;
      const verticalDistance = Math.abs(touchEndY - touchStartY);

      // Check if it's a right swipe (positive horizontal distance)
      // and horizontal movement is greater than vertical (not a scroll)
      if (horizontalDistance > minSwipeDistance && horizontalDistance > verticalDistance) {
        if (onSwipeBack) {
          onSwipeBack();
        } else {
          void navigate(-1);
        }
      }

      // Reset values
      touchStartX = 0;
      touchStartY = 0;
      touchEndX = 0;
      touchEndY = 0;
    };

    // Determine which element to attach listeners to
    const targetElement = ref?.current ?? document;

    // Add event listeners
    targetElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    targetElement.addEventListener('touchmove', handleTouchMove, { passive: true });
    targetElement.addEventListener('touchend', handleTouchEnd);

    // Cleanup: remove event listeners when component unmounts
    return (): void => {
      targetElement.removeEventListener('touchstart', handleTouchStart);
      targetElement.removeEventListener('touchmove', handleTouchMove);
      targetElement.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isMobile, enabled, minSwipeDistance, edgeThreshold, navigate, onSwipeBack, ref]);
};
