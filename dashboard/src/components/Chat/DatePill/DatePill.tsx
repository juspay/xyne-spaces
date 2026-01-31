import { ReactElement, useEffect, useRef, useState } from 'react';
import Badge from '../../ui/Badge';

export interface DatePillProps {
  dateText: string;
}

export const DatePill = ({ dateText }: DatePillProps): ReactElement => {
  // Default false for rendering grey horizontal rule
  const [showLines, setShowLines] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const INITIAL_CHECK_DELAY_MS = 100;
  const STUCK_TO_TOP_TOLERANCE_PX = 2;

  // This workaround is particularly to introduce grey horizontal rule for DatePills at the start of a day in a conversation
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Virtuoso-specific: returns null outside GroupedVirtuoso (used in ChatListV2), so no listeners are attached.
    const scrollContainer = wrapper.closest('[data-virtuoso-scroller]');
    if (!scrollContainer) return;

    const checkIfSticky = () => {
      const stickyParent = wrapper.parentElement;
      if (!stickyParent) return;

      const parentRect = stickyParent.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();

      // If the parent is stuck at the top of the container (within 2px tolerance)
      const isStuckAtTop = Math.abs(parentRect.top - containerRect.top) < STUCK_TO_TOP_TOLERANCE_PX;

      // Show lines only when NOT stuck at top
      setShowLines(!isStuckAtTop);
    };

    scrollContainer.addEventListener('scroll', checkIfSticky, { passive: true });
    setTimeout(checkIfSticky, INITIAL_CHECK_DELAY_MS);

    return () => {
      scrollContainer.removeEventListener('scroll', checkIfSticky);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      data-component='date-pill'
      className='relative flex items-center justify-center py-2 bg-transparent'
    >
      {showLines && (
        <div className='absolute left-0 right-0 top-1/2 h-px bg-gray-300 -translate-y-1/2' />
      )}

      <div className='relative bg-white'>
        <Badge variant='outline'>{dateText}</Badge>
      </div>
    </div>
  );
};
