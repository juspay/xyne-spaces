import {
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  CalendarDays,
  LayoutGrid,
  Loader2,
  Search,
  SignalHigh,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { cn } from '../../../utils/classNames';
import Avatar from '../../ui/Avatar/Avatar';
import type { TokenIcon } from '../../../search/filterRegistry';
import { ChannelChipIcon, PRIORITY_ICON_COLOR } from '../../Chat/ChatDirectory/FilterChipNode';
import { useShortcut } from '../../../shortcuts';

/** An applied filter, shown as a token inside the box the way Slack shows them. */
export interface QueryToken {
  key: string;
  /** The `in:` / `from:` part, drawn before the glyph. See FilterToken in the registry. */
  prefix?: string;
  label: string;
  onRemove: () => void;
  /** Leading glyph — a person's avatar, or a kind icon. See TokenIcon in the registry. */
  icon?: TokenIcon;
}

interface SearchQueryInputProps {
  /** The committed query — the one the results currently on screen were fetched for. */
  query: string;
  /**
   * Applied filters, rendered as read-only tokens ahead of the text. They make the box
   * show the whole search rather than just its free-text half; editing still only ever
   * touches the text, so a token can't be half-typed into an invalid state.
   */
  tokens?: QueryToken[];
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
/**
 * A token's leading glyph. Users show their real avatar rather than a generic person icon —
 * the chip is about a specific person, and the palette's chips already read that way.
 */
function TokenGlyph({ icon }: { icon?: TokenIcon | undefined }): ReactElement | null {
  if (!icon) return null;
  if (icon.kind === 'user') {
    return <Avatar userId={icon.userId} size='xs' showActiveStatus={false} />;
  }
  // Channels resolve their own glyph from visibility/scope — a private channel reads as a
  // lock here just as it does in the palette, not as a hash.
  if (icon.kind === 'channel') {
    return (
      <span className='inline-flex shrink-0 items-center text-muted-foreground'>
        <ChannelChipIcon id={icon.channelId} size={11} />
      </span>
    );
  }
  if (icon.kind === 'priority') {
    return (
      <SignalHigh
        size={11}
        className={cn('shrink-0', PRIORITY_ICON_COLOR[icon.value] ?? 'text-muted-foreground')}
      />
    );
  }
  const Icon =
    icon.kind === 'date' ? CalendarDays : icon.kind === 'board' ? LayoutGrid : SlidersHorizontal;
  return <Icon size={11} className='shrink-0 text-muted-foreground' />;
}

export function SearchQueryInput({
  query,
  tokens = [],
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
      if (event.key === 'Backspace' && value === '' && tokens.length > 0) {
        event.preventDefault();
        tokens[tokens.length - 1]?.onRemove();
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
    [onLiveChange, onSubmit, query, value, tokens],
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
        'flex flex-wrap items-center gap-2 min-h-10 px-3 py-1 rounded-xl border border-border bg-background',
        'transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
      )}
    >
      {isSearching ? (
        <Loader2 size={16} className='shrink-0 animate-spin text-primary' />
      ) : (
        <Search size={16} className='shrink-0 text-muted-foreground' />
      )}
      {tokens.map(token => (
        <span
          key={token.key}
          className='inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground'
        >
          {token.prefix && <span className='text-muted-foreground'>{token.prefix}</span>}
          <TokenGlyph icon={token.icon} />
          <span className='max-w-[160px] truncate'>{token.label}</span>
          <button
            type='button'
            onClick={token.onRemove}
            aria-label={`Remove ${token.label}`}
            className='text-muted-foreground hover:text-foreground'
            data-track-category='SEARCH_RESULTS'
            data-track-name='REMOVE_QUERY_TOKEN'
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        // The cold-start prompt only makes sense on an empty box; among applied tokens it
        // claims nothing is searched yet. The leading magnifier already says what this is,
        // so it shrinks rather than explains.
        placeholder={tokens.length > 0 ? 'Search' : 'Search messages, files, tickets…'}
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
