import { ReactElement, useEffect, useRef, useState } from 'react';
import Badge from '../../ui/Badge';

export interface DatePillProps {
  dateText: string;
}

export const DatePill = ({ dateText }: DatePillProps): ReactElement => {
  // Default false for rendering grey horizontal rule
  const [showLines, setShowLines] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const INITIAL_CHECK_DELAY_MS = 100;
  const STUCK_TO_TOP_TOLERANCE_PX = 2;

  // This workaround is particularly to introduce grey horizontal rule for DatePills at the start of a day in a conversation
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Virtuoso-specific: returns null outside GroupedVirtuoso (used in ChatListV2), so no listeners are attached.
    const scrollContainer = wrapper.closest('[data-virtuoso-scroller]');
    if (!scrollContainer) return;

    const checkIfSticky = (): void => {
      const stickyParent = wrapper.parentElement;
      if (!stickyParent) return;

      const parentRect = stickyParent.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();

      // If the parent is stuck at the top of the container (within 2px tolerance)
      const isStuckAtTop = Math.abs(parentRect.top - containerRect.top) < STUCK_TO_TOP_TOLERANCE_PX;

      // Show lines only when NOT stuck at top
      setShowLines(!isStuckAtTop);
    };

    // Throttle the scroll handler with rAF to avoid setState on every scroll frame
    const onScroll = (): void => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        checkIfSticky();
        rafRef.current = null;
      });
    };

    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(checkIfSticky, INITIAL_CHECK_DELAY_MS);

    return () => {
      scrollContainer.removeEventListener('scroll', onScroll);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      data-component='date-pill'
      className='relative flex items-center justify-center py-2 bg-transparent'
    >
      {/* Always render the line in the DOM to maintain constant height;
          toggle visibility via opacity so Virtuoso's height tracking stays stable. */}
      <div
        className={`absolute left-0 right-0 top-1/2 h-px bg-gray-300 -translate-y-1/2 transition-opacity duration-150 ${showLines ? 'opacity-100' : 'opacity-0'}`}
      />

      <div className='relative'>
        <Badge variant='outline' className='bg-background'>
          {dateText}
        </Badge>
      </div>
    </div>
  );
};
