import { cn } from '../../../utils/classNames';

interface PaginationIndicatorProps {
  currentPage: number;
  totalPageCount: number;
  vertical?: boolean;
}

export function PaginationIndicator({
  currentPage,
  totalPageCount,
  vertical = false,
}: PaginationIndicatorProps): React.ReactElement | null {
  if (totalPageCount <= 1) return null;

  return (
    <div
      className={cn(
        'absolute z-10',
        vertical
          ? 'right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1.5'
          : 'bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5',
      )}
    >
      {Array.from({ length: totalPageCount }, (_, i) => (
        <div
          key={i}
          className={cn(
            'rounded-full transition-all',
            vertical ? 'w-2 h-2' : 'w-2 h-2',
            i === currentPage
              ? vertical
                ? 'bg-background h-6'
                : 'bg-background w-6'
              : 'bg-background/40 hover:bg-background/60',
          )}
        />
      ))}
    </div>
  );
}
