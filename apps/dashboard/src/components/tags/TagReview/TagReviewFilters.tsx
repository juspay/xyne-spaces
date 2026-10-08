/**
 * The toolbar's filter pills.
 *
 * Multi-select within a group, AND across groups — the same contract as the ticket list's
 * filters, so a reviewer who has used one already knows this one.
 *
 * Options and their counts come from the SERVER. The client holds one page, and a page
 * cannot be counted to produce totals for the whole set; it also cannot know about a proposer
 * whose tags all sit on some other page. Each count is taken with every other group's filter
 * applied but not its own, so selecting one option never zeroes out its siblings.
 */
import { JSX, useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { VocabularyFacet } from '../../../api/threadTypeVocabularyApi';
import { Button } from '../../ui/Button/Button';
import { Popover } from '../../ui/Popover/Popover';
import { cn } from '../../../utils/classNames';

interface TagReviewFilterProps {
  label: string;
  options: VocabularyFacet[];
  selected: string[];
  onChange: (next: string[]) => void;
  /**
   * Adds a search box. For proposers, where a workspace can have hundreds and picking one out
   * of a scroll list is hopeless — and where the thing a reviewer actually knows is an email
   * address, not a display name.
   */
  searchable?: boolean;
  searchPlaceholder?: string;
}

export const TagReviewFilter = ({
  label,
  options,
  selected,
  onChange,
  searchable = false,
  searchPlaceholder = 'Search',
}: TagReviewFilterProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter(
      option =>
        option.label.toLowerCase().includes(query) ||
        (option.email ?? '').toLowerCase().includes(query),
    );
  }, [options, search]);

  const toggle = (value: string): void => {
    onChange(
      selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value],
    );
  };

  const active = selected.length > 0;

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setSearch('');
      }}
      align='start'
      className='w-64 p-1'
      trigger={
        <Button
          variant='outline'
          size='sm'
          className={cn(
            'rounded-[10px] border-border hover:bg-muted text-muted-foreground',
            active && 'text-foreground border-primary/40 bg-primary/5',
          )}
        >
          {label}
          {active && (
            <span className='rounded bg-primary/15 px-1 text-[11px] font-medium text-primary'>
              {selected.length}
            </span>
          )}
          <ChevronDown className='size-3 opacity-60' />
        </Button>
      }
    >
      {searchable && (
        <div className='flex items-center gap-1.5 border-b border-border px-2 pb-1.5'>
          <Search className='size-3.5 shrink-0 text-muted-foreground' />
          <input
            autoFocus
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            data-track-category='TagReview'
            data-track-name='SearchFilter'
            className='w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground'
          />
        </div>
      )}

      <div className='max-h-72 overflow-y-auto'>
        {visible.length === 0 ? (
          <div className='px-2 py-3 text-center text-xs text-muted-foreground'>
            {search ? 'Nobody matches that' : 'Nothing to filter'}
          </div>
        ) : (
          visible.map(option => {
            const checked = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type='button'
                onClick={() => toggle(option.value)}
                data-track-category='TagReview'
                data-track-name='ToggleFilter'
                className='flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted'
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                  )}
                >
                  {checked && <Check className='size-3' />}
                </span>
                <span className='flex min-w-0 flex-1 flex-col'>
                  <span className='min-w-0 truncate'>{option.label}</span>
                  {/* The email is the identifier a reviewer actually recognises — two people
                      can share a display name, and nobody shares an address. */}
                  {option.email ? (
                    <span className='min-w-0 truncate text-[11px] text-muted-foreground'>
                      {option.email}
                    </span>
                  ) : null}
                </span>
                {/* Dimmed at zero rather than hidden: a reviewer looking for a name they know
                    exists should see it is filtered out, not wonder where it went. */}
                <span
                  className={cn(
                    'shrink-0 text-xs tabular-nums',
                    option.count === 0 ? 'text-muted-foreground/40' : 'text-muted-foreground',
                  )}
                >
                  {option.count}
                </span>
              </button>
            );
          })
        )}
      </div>
    </Popover>
  );
};

/** Shown only when something is filtered, so the toolbar is quiet at rest. */
export const ClearFiltersPill = ({ onClear }: { onClear: () => void }): JSX.Element => (
  <Button
    variant='ghost'
    size='sm'
    onClick={onClear}
    data-track-category='TagReview'
    data-track-name='ClearFilters'
    className='rounded-[10px] text-muted-foreground hover:bg-muted'
  >
    <X className='size-3' />
    Clear
  </Button>
);
