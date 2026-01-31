import { useEffect, RefObject } from 'react';

/**
 * Hook to detect clicks outside of a specified element
 * Executes a callback when user clicks outside the referenced element
 *
 * @param ref - React ref object pointing to the element to monitor
 * @param callback - Function to execute when click occurs outside the element
 *
 * @example
 * const ref = useRef<HTMLDivElement>(null);
 * useClickOutside(ref, () => {
 *   console.log('Clicked outside!');
 * });
 * return <div ref={ref}>Content</div>
 */
export const useClickOutside = <T extends HTMLElement = HTMLElement>(
  ref: RefObject<T>,
  callback: () => void,
): void => {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent): void => {
      // Check if the clicked element is outside the ref element
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callback();
      }
    };

    // Add event listeners for both mouse and touch events
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    // Cleanup: remove event listeners when component unmounts
    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [ref, callback]);
};
