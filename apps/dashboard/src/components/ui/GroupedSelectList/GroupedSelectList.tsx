import { ReactElement, ReactNode } from 'react';
import { ChevronRight, SearchDefault as Search } from '@xyne/icons';
import { cn } from '../../../utils/classNames';

interface GroupedSelectListProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  isEmpty: boolean;
  emptyLabel: ReactNode;
  children: ReactNode;
  trackCategory?: string;
  trackName?: string;
  className?: string;
  /** Set false when the caller virtualizes the body and owns its own scroller. */
  scrollable?: boolean;
}

export function GroupedSelectList({
  search,
  onSearchChange,
  searchPlaceholder,
  isEmpty,
  emptyLabel,
  children,
  trackCategory,
  trackName,
  className,
  scrollable = true,
}: GroupedSelectListProps): ReactElement {
  return (
    <div className={cn('flex min-h-0 flex-col', className)} data-slot='grouped-select-list'>
      <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
        <Search className='size-3.5 shrink-0 text-muted-foreground' />
        <input
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          autoComplete='off'
          data-track-category={trackCategory}
          data-track-name={trackName}
          className='flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground'
        />
      </div>
      <div className={cn('min-h-0 p-1', scrollable && 'max-h-80 overflow-y-auto')}>
        {isEmpty ? (
          <div className='px-2 py-6 text-center text-[12px] text-muted-foreground'>
            {emptyLabel}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

interface GroupedSelectGroupProps {
  expanded: boolean;
  onToggleExpand: () => void;
  header: ReactNode;
  count?: number;
  children: ReactNode;
  trackCategory?: string;
  trackName?: string;
}

/**
 * The group's header row on its own — for callers that virtualize and therefore
 * render headers and child rows as flat siblings rather than nested.
 */
export function GroupedSelectGroupHeader({
  expanded,
  onToggleExpand,
  count,
  children,
  trackCategory,
  trackName,
}: Omit<GroupedSelectGroupProps, 'header'>): ReactElement {
  return (
    <div className='flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted'>
      <button
        type='button'
        onClick={onToggleExpand}
        aria-label={expanded ? 'Collapse' : 'Expand'}
        data-track-category={trackCategory}
        data-track-name={trackName}
        className='shrink-0 text-muted-foreground'
      >
        <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
      </button>
      {children}
      {count !== undefined && count > 0 && (
        <span className='rounded-full bg-primary px-1.5 py-0.5 text-[11px] tabular-nums text-primary-foreground'>
          {count}
        </span>
      )}
    </div>
  );
}

export function GroupedSelectGroup({
  expanded,
  onToggleExpand,
  header,
  count,
  children,
  trackCategory,
  trackName,
}: GroupedSelectGroupProps): ReactElement {
  return (
    <div data-slot='grouped-select-group'>
      <GroupedSelectGroupHeader
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        {...(count !== undefined && { count })}
        {...(trackCategory !== undefined && { trackCategory })}
        {...(trackName !== undefined && { trackName })}
      >
        {header}
      </GroupedSelectGroupHeader>
      {expanded && <div className='mb-1 ml-6 mt-0.5 flex flex-col gap-1'>{children}</div>}
    </div>
  );
}

export function GroupedSelectRow({
  children,
  indented = false,
}: {
  children: ReactNode;
  indented?: boolean;
}): ReactElement {
  return (
    <div
      className={cn('flex items-center gap-2 px-2 py-1', indented && 'ml-6')}
      data-slot='grouped-select-row'
    >
      {children}
    </div>
  );
}

export const GROUPED_SELECT_LIST_HEIGHT = 320;
