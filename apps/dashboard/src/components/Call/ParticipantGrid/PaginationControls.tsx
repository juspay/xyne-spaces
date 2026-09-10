import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '../../../utils/classNames';

interface PaginationControlsProps {
  currentPage: number;
  totalPageCount: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  compact?: boolean;
  vertical?: boolean;
}

export function PaginationControls({
  currentPage,
  totalPageCount,
  onNextPage,
  onPrevPage,
  compact = false,
  vertical = false,
}: PaginationControlsProps): React.ReactElement | null {
  if (totalPageCount <= 1) return null;

  const PrevIcon = vertical ? ChevronUp : ChevronLeft;
  const NextIcon = vertical ? ChevronDown : ChevronRight;

  return (
    <>
      {currentPage > 0 && (
        <button
          onClick={onPrevPage}
          className={cn(
            'absolute z-10',
            'bg-background hover:bg-muted text-foreground rounded-full',
            'transition-all backdrop-blur-sm',
            compact ? 'p-1' : 'p-2',
            vertical ? 'left-1/2 -translate-x-1/2 top-2' : 'left-2 top-1/2 -translate-y-1/2',
          )}
          aria-label={vertical ? 'Previous page (up)' : 'Previous page (left)'}
          data-track-category='CALLS'
          data-track-name='Pagination_Prev'
          data-track-metadata={JSON.stringify({ currentPage, totalPages: totalPageCount })}
        >
          <PrevIcon className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
        </button>
      )}
      {currentPage < totalPageCount - 1 && (
        <button
          onClick={onNextPage}
          className={cn(
            'absolute z-10',
            'bg-background hover:bg-muted text-foreground rounded-full',
            'transition-all backdrop-blur-sm',
            compact ? 'p-1' : 'p-2',
            vertical ? 'left-1/2 -translate-x-1/2 bottom-2' : 'right-2 top-1/2 -translate-y-1/2',
          )}
          aria-label={vertical ? 'Next page (down)' : 'Next page (right)'}
          data-track-category='CALLS'
          data-track-name='Pagination_Next'
          data-track-metadata={JSON.stringify({ currentPage, totalPages: totalPageCount })}
        >
          <NextIcon className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
        </button>
      )}
    </>
  );
}
