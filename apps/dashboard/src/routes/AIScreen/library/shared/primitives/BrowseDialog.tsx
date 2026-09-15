import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronBigLeft, FilterLines, MultipleCrossCancelDefault, SearchBig } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Dialog } from '@/components/ui/Dialog/index';
import { Skeleton } from '@/components/ui/Skeleton';

export interface FilterOption {
  id: string | null;
  label: string;
}

const FilterMenu = ({
  options,
  active,
  onChange,
  trackName,
}: {
  options: readonly FilterOption[];
  active: string | null;
  onChange: (next: string | null) => void;
  trackName: string;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={containerRef} className='relative shrink-0'>
      <button
        type='button'
        onClick={() => setOpen(value => !value)}
        aria-label='Filter'
        aria-expanded={open}
        data-track-category='Claw Agents'
        data-track-name={trackName}
        className={cn(
          'flex size-7 items-center justify-center rounded-[10px] transition-colors hover:bg-background/60',
          active || open ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <FilterLines className='size-4' aria-hidden />
      </button>
      {open && (
        <div className='absolute right-0 top-full z-10 mt-1.5 flex w-48 flex-col rounded-xl border border-border bg-popover p-1 shadow-md'>
          {options.map(option => (
            <button
              key={option.id ?? 'all'}
              type='button'
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
              data-track-category='Claw Agents'
              data-track-name={trackName}
              data-track-metadata={JSON.stringify({ option: option.label })}
              className={cn(
                'rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
                active === option.id ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CardSkeleton = (): ReactElement => (
  <div className='flex flex-col gap-2 p-2.5'>
    <div className='flex items-center gap-2'>
      <Skeleton className='size-7 shrink-0 rounded-lg' />
      <Skeleton className='h-3.5 w-24' />
    </div>
    <Skeleton className='h-3 w-full max-w-56' />
  </div>
);

interface BrowseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  testId: string;
  detail?: { label: string; onBack: () => void; content: ReactNode } | undefined;
  query?: string;
  onQueryChange?: (next: string) => void;
  filterOptions?: readonly FilterOption[];
  activeFilter?: string | null;
  onFilterChange?: (next: string | null) => void;
  toolbar?: ReactNode;
  chips?: ReactNode;
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyMessage: string | null;
  children: ReactNode;
}

/** Reset local search/filter/detail state whenever a browse dialog closes. */
export function handleBrowseDialogOpenChange(
  next: boolean,
  onOpenChange: (open: boolean) => void,
  reset: () => void,
): void {
  if (!next) reset();
  onOpenChange(next);
}

export function BrowseDialog({
  open,
  onOpenChange,
  title,
  description,
  testId,
  detail,
  query = '',
  onQueryChange,
  filterOptions = [],
  activeFilter = null,
  onFilterChange,
  toolbar,
  chips,
  loading,
  isError,
  onRetry,
  emptyMessage,
  children,
}: BrowseDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      testId={testId}
      className='flex h-[min(85vh,720px)] w-full max-w-[800px] flex-col gap-4 overflow-hidden rounded-2xl border-[0.8px] border-border bg-card p-1'
    >
      <div
        className={cn(
          'flex h-9 shrink-0 items-center justify-between gap-2 pr-2',
          detail ? 'pl-1' : 'pl-[18px]',
        )}
      >
        {detail ? (
          <button
            type='button'
            onClick={detail.onBack}
            title={`Back to ${title}`}
            aria-label={`Back to ${title}`}
            data-track-category='Claw Agents'
            data-track-name='Create agent v2: browse back'
            className='flex h-7 shrink-0 items-center rounded-[10px] pr-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            <span className='flex h-7 w-[22px] shrink-0 items-center justify-center'>
              <ChevronBigLeft className='size-4' aria-hidden />
            </span>
            <span className='text-sm font-normal leading-5 tracking-[-0.28px]'>Back</span>
          </button>
        ) : (
          <span className='text-base font-semibold leading-6 tracking-[-0.16px] text-foreground'>
            {title}
          </span>
        )}
        <button
          type='button'
          onClick={() => onOpenChange(false)}
          aria-label='Close'
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: close browse dialog'
          className='flex size-7 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <MultipleCrossCancelDefault className='size-4' aria-hidden />
        </button>
      </div>

      {detail ? (
        detail.content
      ) : (
        <>
          {onQueryChange && (
            <div className='shrink-0 px-2'>
              <div className='flex h-9 items-center gap-4 rounded-[10px] bg-muted pl-2.5 pr-1'>
                <div className='flex h-full min-w-0 flex-1 items-center gap-2'>
                  <SearchBig className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                  <input
                    value={query}
                    onChange={event => onQueryChange(event.target.value)}
                    placeholder='Search'
                    aria-label={`Search ${title}`}
                    data-track-category='Claw Agents'
                    data-track-name='Create agent v2: browse search'
                    className='min-w-0 flex-1 bg-transparent text-sm font-medium leading-5 tracking-[-0.28px] text-foreground placeholder:text-muted-foreground focus:outline-none'
                  />
                </div>
                {onFilterChange && (
                  <FilterMenu
                    options={filterOptions}
                    active={activeFilter}
                    onChange={onFilterChange}
                    trackName='Create agent v2: browse filter'
                  />
                )}
              </div>
            </div>
          )}

          {toolbar && <div className='shrink-0 px-2'>{toolbar}</div>}

          {chips && <div className='max-h-[92px] shrink-0 overflow-y-auto'>{chips}</div>}

          <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3'>
            {loading ? (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                {Array.from({ length: 6 }, (_, index) => (
                  <CardSkeleton key={index} />
                ))}
              </div>
            ) : isError ? (
              <div className='flex flex-1 flex-col items-center justify-center gap-3 text-center'>
                <p className='text-sm font-normal text-muted-foreground'>
                  Couldn&apos;t load this list.
                </p>
                <button
                  type='button'
                  onClick={onRetry}
                  data-track-category='Claw Agents'
                  data-track-name='Create agent v2: browse retry'
                  className='text-sm font-medium text-[color:var(--mention-color)] underline underline-offset-2'
                >
                  Retry
                </button>
              </div>
            ) : emptyMessage ? (
              <div className='flex flex-1 items-center justify-center px-6'>
                <p className='text-center text-sm font-normal leading-5 text-muted-foreground'>
                  {emptyMessage}
                </p>
              </div>
            ) : (
              children
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
