import { useEffect, useRef, useState } from 'react';

/**
 * Generic hook to execute a callback when an element becomes visible in viewport
 * Uses Intersection Observer API to detect visibility
 *
 * @param callback - Function to execute when element becomes visible
 * @param options - Intersection Observer options
 * @param options.threshold - Percentage of element that must be visible (0-1, default: 0.5)
 * @param options.triggerOnce - Only trigger callback once (default: true)
 * @returns ref - Attach this ref to the element you want to observe
 *
 * @example
 * const ref = useIntersectionObserver(() => {
 *   console.log('Element is visible!');
 * });
 * return <div ref={ref}>Content</div>
 */
export const useIntersectionObserver = <T extends HTMLElement = HTMLDivElement>(
  callback: () => void,
  options?: {
    threshold?: number;
    triggerOnce?: boolean;
  },
): React.RefObject<T | null> => {
  const { threshold = 0.5, triggerOnce = true } = options || {};
  const [hasTriggered, setHasTriggered] = useState(false);
  const elementRef = useRef<T>(null);

  useEffect(() => {
    if (!elementRef.current) return;
    if (triggerOnce && hasTriggered) return;

    // Create an Intersection Observer
    // This watches when the element becomes visible in the viewport
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        // entry.isIntersecting is true when element is visible
        if (entry && entry.isIntersecting) {
          if (triggerOnce) {
            setHasTriggered(true);
          }

          // Execute the callback
          callback();
        }
      },
      {
        threshold, // Trigger when specified % of element is visible
      },
    );

    // Start observing the element
    observer.observe(elementRef.current);

    // Cleanup: stop observing when component unmounts
    return (): void => {
      observer.disconnect();
    };
  }, [callback, threshold, triggerOnce, hasTriggered]);

  return elementRef;
};
