import {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
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
import {
  buildChipText,
  ChannelChipIcon,
  isSelfMentionChip,
  PRIORITY_ICON_COLOR,
} from '../../Chat/ChatDirectory/FilterChipNode';
import type { ChipData } from '../ChatDirectory/ChannelCommandMenu.types';
import { useShortcut } from '../../../shortcuts';
import { useAuthContextValues } from '../../../hooks/useAuth';
import type { SearchResultsFilters } from '../../../hooks/useSearchResultsScreen';
import { useQuerySuggestions } from './filters/useQuerySuggestions';

/** An applied filter, shown as a token inside the box the way Slack shows them. */ // HMRPROBE2
export interface QueryToken {
  key: string;
  /** The `in:` / `from:` part, drawn before the glyph. See FilterToken in the registry. */
  prefix?: string;
  label: string;
  onRemove: () => void;
  /** Leading glyph — a person's avatar, or a kind icon. See TokenIcon in the registry. */
  icon?: TokenIcon;
  /** Set when the token stands for a chip, so the chip helpers can be used directly. */
  chip?: ChipData;
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
  /**
   * Current filters, so typing `from:` can offer candidates and apply the pick. Without
   * these the box could only ever edit free text, which is why `from:` used to be
   * settable solely by clicking the From button.
   */
  filters: SearchResultsFilters;
  onFiltersChange: (next: SearchResultsFilters) => void;
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
/** Ties the wrapping <label> to the text input so a click anywhere focuses it. */
const QUERY_INPUT_ID = 'search-query-input';

function TokenGlyph({ icon }: { icon?: TokenIcon | undefined }): ReactElement | null {
  if (!icon) return null;
  if (icon.kind === 'user') {
    return <Avatar userId={icon.userId} size='xs' showActiveStatus={false} />;
  }
  // Channels resolve their own glyph from visibility/scope — a private channel reads as a
  // lock here just as it does in the palette, not as a hash.
  if (icon.kind === 'channel') {
    return (
      <span className='inline-flex shrink-0 items-center'>
        <ChannelChipIcon id={icon.channelId} size={16} />
      </span>
    );
  }
  if (icon.kind === 'priority') {
    return (
      <SignalHigh size={16} className={cn('shrink-0', PRIORITY_ICON_COLOR[icon.value] ?? '')} />
    );
  }
  const Icon =
    icon.kind === 'date' ? CalendarDays : icon.kind === 'board' ? LayoutGrid : SlidersHorizontal;
  // No colour: the glyph inherits `--chip-fg` from the pill, matching the palette's chip.
  return <Icon size={16} className='shrink-0' />;
}

export function SearchQueryInput({
  query,
  tokens = [],
  filters,
  onFiltersChange,
  onSubmit,
  onLiveChange,
  isSearching,
}: SearchQueryInputProps): ReactElement {
  const { userID: currentUserId } = useAuthContextValues();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(query);
  const [activeIndex, setActiveIndex] = useState(0);

  const typeahead = useQuerySuggestions(value, filters);
  const suggestions = useMemo(() => typeahead?.suggestions ?? [], [typeahead]);

  // Applying a pick also removes the `from:nas` text that summoned it — the filter is now
  // a token, and leaving the syntax behind would search for it as words too.
  const pick = useCallback(
    (index: number): void => {
      const chosen = suggestions[index];
      if (!chosen || !typeahead) return;
      onFiltersChange({ ...filters, ...chosen.apply(filters) });
      // The typeahead only ever matches at the end, so everything from its start goes.
      const next = value.slice(0, typeahead.index);
      setValue(next);
      onLiveChange(next);
      setActiveIndex(0);
      // Applying a filter re-renders the results screen; keep the caret here so the next
      // prefix can be typed straight away instead of clicking back into the box.
      inputRef.current?.focus();
    },
    [suggestions, typeahead, filters, onFiltersChange, value, onLiveChange],
  );

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
      setActiveIndex(0);
      onLiveChange(next);
    },
    [onLiveChange],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      // While the typeahead is open it owns Enter and the arrows — otherwise Enter would
      // run a search for the half-typed `from:nas` instead of picking the highlighted row.
      if (suggestions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex(i => (i + 1) % suggestions.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex(i => (i - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          pick(activeIndex);
          return;
        }
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onSubmit(value.trim());
        inputRef.current?.focus();
        return;
      }
      // Backspace *demotes* rather than deletes, matching the palette: the filter comes
      // off, but its text goes back in the box so it can be corrected instead of retyped.
      // `buildChipText` is the palette's own demotion text, so both boxes leave behind the
      // same string and re-arm the same way.
      if (event.key === 'Backspace' && value === '' && tokens.length > 0) {
        event.preventDefault();
        const last = tokens[tokens.length - 1];
        if (!last) return;
        last.onRemove();
        const demoted = last.chip ? buildChipText(last.chip) : `${last.prefix ?? ''}${last.label}`;
        setValue(demoted);
        onLiveChange(demoted);
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
    [onLiveChange, onSubmit, query, value, tokens, suggestions, activeIndex, pick],
  );

  const handleClear = useCallback((): void => {
    setValue('');
    onLiveChange('');
    onSubmit('');
    inputRef.current?.focus();
  }, [onLiveChange, onSubmit]);

  return (
    // A <label> rather than a <div>: clicking anywhere in the box — its padding and the
    // gaps between tokens included — focuses the input natively, with no handler to keep
    // in sync and no a11y role to fake.
    <label
      htmlFor={QUERY_INPUT_ID}
      className={cn(
        'relative flex flex-wrap items-center gap-2 min-h-10 px-3 py-1 rounded-xl border border-border bg-background',
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
          // The same `.filter-chip` the cmd+K box renders, so a filter looks identical on
          // both surfaces. The × is the one addition: these tokens are click-removable,
          // where the palette's chips are deleted with Backspace inside the editor.
          className={cn(
            'filter-chip shrink-0',
            token.chip &&
              isSelfMentionChip(token.chip, currentUserId) &&
              'filter-chip--self-mention',
          )}
        >
          {token.prefix && <span>{token.prefix}</span>}
          <TokenGlyph icon={token.icon} />
          <span className='max-w-[160px] truncate'>{token.label}</span>
          <button
            type='button'
            // Keep the caret in the box: without this the button takes focus on mousedown
            // and the next prefix can't be typed without clicking back in.
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
              token.onRemove();
              inputRef.current?.focus();
            }}
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
        id={QUERY_INPUT_ID}
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
      {suggestions.length > 0 && (
        <div
          role='listbox'
          className='absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md'
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.icon.kind}-${s.id}`}
              type='button'
              role='option'
              aria-selected={i === activeIndex}
              // The input must keep focus, or the menu unmounts before the click lands.
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => pick(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-popover-foreground',
                i === activeIndex && 'bg-muted',
              )}
              data-track-category='SEARCH_RESULTS'
              data-track-name='PICK_QUERY_SUGGESTION'
            >
              <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
                {s.icon.kind === 'user' ? (
                  <Avatar userId={s.icon.userId} size='xs' showActiveStatus={false} />
                ) : s.icon.kind === 'channel' ? (
                  <ChannelChipIcon id={s.icon.channelId} size={12} />
                ) : (
                  <SlidersHorizontal size={12} />
                )}
              </span>
              <span className='truncate'>{s.label}</span>
              {i === activeIndex && (
                <span className='ml-auto shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground'>
                  Enter
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}
