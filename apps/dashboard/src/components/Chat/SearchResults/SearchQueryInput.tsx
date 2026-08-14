import { ReactElement, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, Loader2, Search, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { useShortcut } from '../../../shortcuts';

interface SearchQueryInputProps {
  /** The committed query — the one the results currently on screen were fetched for. */
  query: string;
  /** Runs a new search. Receives the trimmed text; '' drops the free-text query. */
  onSubmit: (next: string) => void;
  /** True while a search is in flight — swaps the leading icon for a spinner. */
  isSearching: boolean;
}

/**
 * Editable query box for the full-screen search results header. Replaces the old
 * static "Results for: <query>" line so the query can be refined in place instead of
 * reopening the cmd+K overlay. Filters stay where they are — this edits free text only.
 */
export function SearchQueryInput({
  query,
  onSubmit,
  isSearching,
}: SearchQueryInputProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(query);

  // Re-sync whenever the committed query changes underneath us: back/forward, a fresh
  // cmd+K search while the screen is mounted, or our own commit landing in the URL.
  useEffect(() => {
    setValue(query);
  }, [query]);

  // `/` from anywhere on the results screen jumps into the box. Registered without
  // allowInInputs, so it stays a literal slash whenever a field already has focus.
  useShortcut('/', () => inputRef.current?.focus(), {
    scope: 'global',
    useKey: true,
    description: 'Focus search box',
    category: 'Navigation',
  });

  const isDirty = value.trim() !== query;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onSubmit(value.trim());
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // First Escape discards the edit; the box keeps focus so it can be retyped.
        setValue(query);
      }
    },
    [onSubmit, query, value],
  );

  const handleClear = useCallback((): void => {
    setValue('');
    onSubmit('');
    inputRef.current?.focus();
  }, [onSubmit]);

  return (
    <div
      className={cn(
        'flex items-center gap-2 h-10 px-3 rounded-xl border border-border bg-background',
        'transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
      )}
    >
      {isSearching ? (
        <Loader2 size={16} className='shrink-0 animate-spin text-primary' />
      ) : (
        <Search size={16} className='shrink-0 text-muted-foreground' />
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder='Search messages, files, tickets…'
        aria-label='Search query'
        className={cn(
          'flex-1 min-w-0 bg-transparent text-sm placeholder:text-muted-foreground outline-none',
          // Uncommitted edits sit at full contrast; once Enter lands the text is what the
          // results below are for, so it settles back to grey.
          isDirty ? 'text-foreground' : 'text-muted-foreground',
        )}
        data-track-category='SEARCH_RESULTS'
        data-track-name='EDIT_QUERY'
      />
      {value.length > 0 && (
        <button
          type='button'
          onClick={handleClear}
          aria-label='Clear search'
          title='Clear search'
          className='shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition'
          data-track-category='SEARCH_RESULTS'
          data-track-name='CLEAR_QUERY'
        >
          <X size={14} />
        </button>
      )}
      {isDirty && (
        <span className='hidden sm:inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'>
          <CornerDownLeft size={11} />
          to search
        </span>
      )}
    </div>
  );
}
