import {
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { useShortcut } from '../../../shortcuts';

interface SearchQueryInputProps {
  /** The committed query — the one the results currently on screen were fetched for. */
  query: string;
  /** Runs a new search. Receives the trimmed text; '' drops the free-text query. */
  onSubmit: (next: string) => void;
  /**
   * Fires on every keystroke with the raw typed text so results refresh live as you
   * type — the same debounced path the cmd+K palette uses. This does NOT touch the URL;
   * only `onSubmit` (Enter) commits the query to the URL/history.
   */
  onLiveChange: (next: string) => void;
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
  onLiveChange,
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

  // Typing feeds the live search immediately (debounced by the search hook) without
  // touching the URL. Enter is what commits the query to the URL/history.
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const next = event.target.value;
      setValue(next);
      onLiveChange(next);
    },
    [onLiveChange],
  );

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
        // Feed the committed query back to the live search too, otherwise the box would
        // show `query` while the results below stay on the discarded text.
        setValue(query);
        onLiveChange(query);
      }
    },
    [onLiveChange, onSubmit, query, value],
  );

  const handleClear = useCallback((): void => {
    setValue('');
    onLiveChange('');
    onSubmit('');
    inputRef.current?.focus();
  }, [onLiveChange, onSubmit]);

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
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder='Search messages, files, tickets…'
        aria-label='Search query'
        className={cn(
          'flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none',
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
    </div>
  );
}
