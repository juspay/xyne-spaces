import {
  memo,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  Building2,
  CalendarDays,
  LayoutGrid,
  Search,
  SignalHigh,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
import {
  prefixFilterApplies,
  useQuerySuggestions,
  type QuerySuggestion,
  type QuickSwitchTarget,
} from './filters/useQuerySuggestions';
import { findUnresolvedNames, hasDroppedFilterSyntax } from '../../../utils/searchFilterParser';
import { resolveDateKeyword } from '../../../search/filterModel';
import { detectMentionTrigger } from '../../../search/mentionCandidates';
import { ChipType } from '../ChatDirectory/ChannelCommandMenu.types';
import { FULL_PAGE_QUERY_INPUT_ID, isDialogOpenOverPage } from '../ChatDirectory/cmdkFullPage';

/** An applied filter, shown as a token inside the box the way Slack shows them. */
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
  /** `query` changed only because the page wrote a finished search to the URL: not re-seeded. */
  queryIsOwnWrite?: boolean;
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
  /** Commits the query to the URL. Never adds a history entry — see handleQuerySubmit. */
  onSubmit: (next: string) => void;
  /**
   * Fires on every keystroke with the raw typed text so results refresh live as you
   * type — the same debounced path the cmd+K palette uses. This does NOT touch the URL;
   * only `onSubmit` (Enter) commits the query to the URL/history.
   */
  onLiveChange: (next: string) => void;
  /**
   * Enter, as in the palette: opens the result highlighted under the box and returns true, or
   * returns false when none is (the search hasn't settled, nothing matched) — then Enter runs the
   * search instead.
   */
  onOpenSelection?: () => boolean;
  /**
   * `@person` or `#channel` picked in an otherwise empty box: opens that DM or channel, as the
   * palette's quick switch does.
   */
  onOpenTarget?: (target: QuickSwitchTarget, rank: number) => void;
  /** Escape or Clear threw the edit away: the result picked under the box goes too. */
  onResetSelection?: () => void;
  /**
   * Take focus when the box appears, so typing goes straight in — Cmd+K landing on full page, or
   * the palette expanding into it. Waits for a dialog over the page (the palette handing off) to
   * go first, and never takes focus from something the user has already moved into.
   */
  autoFocus?: boolean;
  /**
   * Bumped to send the caret here on demand (Cmd+K / Cmd+F on the results page): focuses the box
   * with the caret after its text, ready to edit.
   */
  focusRequest?: number;
}

// The longest the box waits for a dialog over the page to go before giving up on taking focus.
const AUTO_FOCUS_WAIT_MS = 3000;

/**
 * The box holds a filter that isn't settled yet: syntax the URL sync would drop (an unpicked
 * `from:` name, a bare `board:`), or a board or date value still being picked. Writing the text to
 * the URL then would take that part out of the box too, so the page doesn't.
 */
export function holdsUnsettledFilter(text: string): boolean {
  if (hasDroppedFilterSyntax(text)) return true;
  // A board is set by picking it, as in the palette.
  if (detectMentionTrigger(text, { enableToTrigger: false })?.type === ChipType.BOARD) return true;
  // Every date typed so far must be whole for the URL to take it as a filter.
  return [...text.matchAll(/\b(?:on|after|before):\s*(.*?)(?=\s+\S+:|$)/gi)].some(
    match => !isWholeDate(match[1] ?? ''),
  );
}

/**
 * A date the query parser reads whole: `YYYY-MM-DD`, `12 jan 24`, or a one-word keyword
 * (`yesterday`). It reads one word after the prefix, so `last 7 days` is not whole when typed;
 * it is picked from the list instead.
 */
function isWholeDate(value: string): boolean {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}(\s|$)/.test(text)) return true;
  if (
    /^\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4}(\s|$)/i.test(text)
  ) {
    return true;
  }
  const firstWord = text.split(/\s+/)[0] ?? '';
  return !!firstWord && !!resolveDateKeyword(firstWord);
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
const QUERY_INPUT_ID = FULL_PAGE_QUERY_INPUT_ID;

/** Glyph-only token kinds. The rest (user/channel/priority) render their own component. */
const GLYPH_BY_ICON_KIND: Partial<Record<TokenIcon['kind'], typeof CalendarDays>> = {
  date: CalendarDays,
  board: LayoutGrid,
  entity: Building2,
  userGroup: Users,
};

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
  const Icon = GLYPH_BY_ICON_KIND[icon.kind] ?? SlidersHorizontal;
  // No colour: the glyph inherits `--chip-fg` from the pill, matching the palette's chip.
  return <Icon size={16} className='shrink-0' />;
}

// ── The typeahead list ─────────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 32;
const HEADING_HEIGHT = 26;
// The list's top and bottom padding, kept by the virtualizer so a row scrolled to sits fully in view.
const LIST_PADDING = 4;

/** The DOM id of a row, for the input's `aria-activedescendant` (an id can't hold spaces). */
const suggestionOptionId = (listboxId: string, suggestion: QuerySuggestion): string =>
  `${listboxId}-${suggestion.id.replace(/\s+/g, '_')}`;

type ListItem =
  | { kind: 'heading'; label: string }
  | { kind: 'row'; suggestion: QuerySuggestion; index: number };

function SuggestionIcon({ icon }: { icon: QuerySuggestion['icon'] }): ReactElement {
  switch (icon.kind) {
    case 'user':
      return <Avatar userId={icon.userId} size='xs' showActiveStatus={false} />;
    case 'channel':
      return <ChannelChipIcon id={icon.channelId} size={12} />;
    case 'userGroup':
      return <Users size={12} />;
    case 'priority':
      return <SignalHigh size={14} className={PRIORITY_ICON_COLOR[icon.value] ?? ''} />;
    case 'board':
      return <LayoutGrid size={12} />;
    case 'date':
      return <CalendarDays size={12} />;
    default:
      return <SlidersHorizontal size={12} />;
  }
}

// Memoized so moving the highlight re-renders the two rows it touches, not every avatar.
const SuggestionRow = memo(function SuggestionRow({
  suggestion,
  index,
  optionId,
  active,
  onHover,
  onPick,
}: {
  suggestion: QuerySuggestion;
  index: number;
  optionId: string;
  active: boolean;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
}): ReactElement {
  return (
    <button
      id={optionId}
      type='button'
      role='option'
      aria-selected={active}
      tabIndex={-1}
      // The input must keep focus, or the menu unmounts before the click lands.
      onMouseDown={e => e.preventDefault()}
      // Only a pointer that moves picks a row: the list scrolling under a still pointer (the arrows
      // keep the highlight in view) or a menu closing over it must not move the highlight, as in
      // the palette.
      onMouseMove={e => {
        if (!active && (e.movementX !== 0 || e.movementY !== 0)) onHover(index);
      }}
      onClick={() => onPick(index)}
      className={cn(
        'flex h-full w-full items-center gap-2 rounded px-2 text-left text-sm text-popover-foreground',
        active && 'bg-muted',
      )}
      data-track-category='SEARCH_RESULTS'
      data-track-name='PICK_QUERY_SUGGESTION'
    >
      <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
        <SuggestionIcon icon={suggestion.icon} />
      </span>
      <span className='min-w-0 truncate'>{suggestion.label}</span>
      {/* The section heading, for a screen reader: a DM and a person can share a name. */}
      <span className='sr-only'>, {suggestion.section}</span>
      {suggestion.detail && (
        <span className='min-w-0 truncate text-xs text-muted-foreground'>{suggestion.detail}</span>
      )}
      {active && (
        <span className='ml-auto shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground'>
          Enter
        </span>
      )}
    </button>
  );
});

/**
 * The query box's typeahead: every row the palette lists, under its section headings. A list can
 * run to thousands of rows (`in:`), so only the visible ones are drawn, and the highlighted row is
 * kept in view as the arrows move it.
 */
function QuerySuggestionList({
  listboxId,
  suggestions,
  activeIndex,
  emptyText,
  onHover,
  onPick,
}: {
  listboxId: string;
  suggestions: QuerySuggestion[];
  activeIndex: number;
  /** Shown when nothing matches what's typed, so a held Enter has a visible reason. */
  emptyText: string;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = useMemo((): ListItem[] => {
    const list: ListItem[] = [];
    suggestions.forEach((suggestion, index) => {
      if (suggestion.section !== suggestions[index - 1]?.section) {
        list.push({ kind: 'heading', label: suggestion.section });
      }
      list.push({ kind: 'row', suggestion, index });
    });
    return list;
  }, [suggestions]);
  const itemIndexOfRow = useMemo(() => {
    const map = new Map<number, number>();
    items.forEach((item, i) => {
      if (item.kind === 'row') map.set(item.index, i);
    });
    return map;
  }, [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: i => (items[i]?.kind === 'heading' ? HEADING_HEIGHT : ROW_HEIGHT),
    // Keyed, so a heading moving to another index takes its own height with it.
    getItemKey: i => {
      const item = items[i];
      if (!item) return i;
      return item.kind === 'row' ? item.suggestion.id : `heading-${item.label}`;
    },
    overscan: 8,
    paddingStart: LIST_PADDING,
    paddingEnd: LIST_PADDING,
    scrollPaddingStart: LIST_PADDING,
    scrollPaddingEnd: LIST_PADDING,
  });

  useEffect(() => {
    const at = itemIndexOfRow.get(activeIndex);
    if (at === undefined) return;
    // The first row also brings its heading into view.
    virtualizer.scrollToIndex(activeIndex === 0 ? 0 : at, { align: 'auto' });
  }, [activeIndex, itemIndexOfRow, virtualizer]);

  return (
    // The list is never focused itself: the ARIA combobox pattern drives it from the input through
    // aria-activedescendant, so it takes no tabIndex.
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
    <div
      ref={scrollRef}
      id={listboxId}
      role='listbox'
      aria-label='Suggestions'
      // The box keeps focus whatever part of the list is pressed (a heading, the padding, the
      // empty panel): the list only shows while the box has focus.
      onMouseDown={e => e.preventDefault()}
      className='absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover px-1 shadow-md'
    >
      {suggestions.length === 0 ? (
        // Announced through the box's own status region; this is the visible copy.
        <div className='px-2 py-4 text-center text-sm text-muted-foreground' aria-hidden>
          {emptyText}
        </div>
      ) : (
        <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(virtual => {
            const item = items[virtual.index];
            if (!item) return null;
            const style = {
              position: 'absolute' as const,
              top: 0,
              left: 0,
              width: '100%',
              height: virtual.size,
              transform: `translateY(${virtual.start}px)`,
            };
            if (item.kind === 'heading') {
              return (
                <div
                  key={`heading-${item.label}`}
                  role='presentation'
                  aria-hidden
                  style={style}
                  className='flex items-end px-2 pb-1 font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground'
                >
                  {item.label}
                </div>
              );
            }
            return (
              <div key={item.suggestion.id} style={style} role='presentation'>
                <SuggestionRow
                  suggestion={item.suggestion}
                  index={item.index}
                  optionId={suggestionOptionId(listboxId, item.suggestion)}
                  active={item.index === activeIndex}
                  onHover={onHover}
                  onPick={onPick}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SearchQueryInput({
  query,
  queryIsOwnWrite = false,
  tokens = [],
  filters,
  onFiltersChange,
  onSubmit,
  onLiveChange,
  onOpenSelection,
  onOpenTarget,
  onResetSelection,
  autoFocus = false,
  focusRequest = 0,
}: SearchQueryInputProps): ReactElement {
  const { userID: currentUserId } = useAuthContextValues();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }, [focusRequest]);

  useEffect(() => {
    if (!autoFocus) return;
    const deadline = performance.now() + AUTO_FOCUS_WAIT_MS;
    let frame = 0;
    const focusWhenClear = (): void => {
      const input = inputRef.current;
      if (!input) return;
      if (isDialogOpenOverPage()) {
        if (performance.now() < deadline) frame = requestAnimationFrame(focusWhenClear);
        return;
      }
      const active = document.activeElement;
      if (active && active !== document.body && active !== input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    };
    focusWhenClear();
    return (): void => cancelAnimationFrame(frame);
  }, [autoFocus]);
  const [value, setValue] = useState(query);
  const [activeIndex, setActiveIndex] = useState(0);
  // Where the caret is; null when it's at the end. Only a prefix before it is being typed, as
  // in the palette.
  const [caret, setCaret] = useState<number | null>(null);
  const trackCaret = useCallback((input: HTMLInputElement): void => {
    const at = input.selectionStart;
    setCaret(at === null || at >= input.value.length ? null : at);
  }, []);
  const caretAt = caret === null ? value.length : Math.min(caret, value.length);

  const typeahead = useQuerySuggestions(value.slice(0, caretAt), filters);
  const before = typeahead ? value.slice(0, typeahead.index) : '';
  const after = value.slice(caretAt);
  // The palette's quick switch: `@person` / `#channel` with nothing else in the box opens it.
  const canQuickSwitch = !!onOpenTarget && tokens.length === 0 && !before.trim() && !after.trim();
  // A row that only opens (its filter isn't on this tab) is offered only when it can.
  const suggestions = useMemo(
    () => (typeahead?.suggestions ?? []).filter(s => s.apply || (s.opens && canQuickSwitch)),
    [typeahead, canQuickSwitch],
  );
  // A new prefix or query starts the highlight on its first row again.
  const typeaheadKey = typeahead ? `${typeahead.index}:${typeahead.syntax}:${typeahead.query}` : '';
  useEffect(() => setActiveIndex(0), [typeaheadKey]);
  const highlighted = Math.min(activeIndex, Math.max(suggestions.length - 1, 0));
  const listboxId = useId();
  // Focus decides whether the list shows at all: a list left over a page the user has moved on to
  // only gets in the way.
  const [focused, setFocused] = useState(false);
  // Nothing to pick for a prefix this tab has a filter for: Enter is held, and the list says why —
  // the rows are still loading, or nothing matches what's typed. With nothing typed after the
  // prefix and nothing loading, Enter isn't held and the list stays closed.
  const holdsEmpty =
    suggestions.length === 0 &&
    !!typeahead?.pickOnly &&
    !typeahead.loadFailed &&
    (typeahead.loading || !!typeahead.query.trim());
  // The rows couldn't be loaded: said so, and Enter isn't held (there will be nothing to pick).
  const showsLoadFailure = suggestions.length === 0 && !!typeahead?.loadFailed;
  const listOpen = focused && (suggestions.length > 0 || holdsEmpty || showsLoadFailure);
  const emptyText = showsLoadFailure
    ? 'Couldn’t load mailbox people'
    : typeahead?.loading
      ? 'Loading…'
      : `No matches for “${typeahead?.query.trim() ?? ''}”`;

  // Applying a pick also removes the `from:nas` text that summoned it — the filter is now
  // a token, and leaving the syntax behind would search for it as words too. Text after the
  // caret stays.
  const pick = useCallback(
    (index: number): void => {
      const chosen = suggestions[index];
      if (!chosen || !typeahead) return;
      if (chosen.opens && onOpenTarget && canQuickSwitch) {
        onOpenTarget(chosen.opens, index + 1);
        setValue('');
        onLiveChange('');
        setCaret(null);
        setActiveIndex(0);
        inputRef.current?.focus();
        return;
      }
      if (!chosen.apply) return;
      onFiltersChange({ ...filters, ...chosen.apply(filters) });
      const next = before + after;
      setValue(next);
      onLiveChange(next);
      setActiveIndex(0);
      setCaret(after ? before.length : null);
      // Applying a filter re-renders the results screen; keep the caret here so the next
      // prefix can be typed straight away instead of clicking back into the box.
      const input = inputRef.current;
      input?.focus();
      if (input && after) {
        requestAnimationFrame(() => input.setSelectionRange(before.length, before.length));
      }
    },
    [
      suggestions,
      typeahead,
      filters,
      onFiltersChange,
      before,
      after,
      canQuickSwitch,
      onOpenTarget,
      onLiveChange,
    ],
  );

  // Latest value, read by the sync effect without making it re-run per keystroke.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Re-seed only on a genuine outside change (back/forward, a fresh cmd+K search). The URL
  // catching up to what was typed would otherwise fight the caret mid-word.
  useEffect(() => {
    if (queryIsOwnWrite || query === valueRef.current.trim()) return;
    setValue(query);
    setCaret(null);
    // Only a change of `query` re-seeds; the flag just says whether that change was the page's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      trackCaret(event.target);
      setActiveIndex(0);
      onLiveChange(next);
      // Emptying commits straight away — nothing left to confirm.
      if (!next.trim()) onSubmit('');
    },
    [onLiveChange, onSubmit, trackCaret],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter') {
        // An IME's Enter confirms the composition (Safari reports it only as keyCode 229); it
        // picks nothing and searches nothing.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        // A held Enter acts once, not once per repeat.
        if (event.repeat) {
          event.preventDefault();
          return;
        }
      }
      // Only a plain Tab picks, as in the palette: Shift+Tab always leaves the box.
      const pickKey = event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey);
      // While the typeahead is open it owns Enter and the arrows — otherwise Enter would
      // run a search for the half-typed `from:nas` instead of picking the highlighted row.
      if (suggestions.length > 0) {
        // The palette ignores Shift+Enter while its list is open; ⌘/Ctrl/Alt+Enter still pick.
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex((highlighted + 1) % suggestions.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex((highlighted - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (pickKey) {
          event.preventDefault();
          pick(highlighted);
          return;
        }
      }
      // A filter value still being typed with nothing to pick (`from:zz`): Enter would search the
      // rest and drop it, so it keeps the text instead, as in the palette. Tab still moves on.
      if (holdsEmpty && event.key === 'Enter') {
        event.preventDefault();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        // A name elsewhere in the box that no pick has resolved, for a filter this tab has (the
        // caret moved past it): Enter takes the caret to the end of the name, where its list says
        // what to pick. On a tab without that filter it is just words: Enter goes on, and the box
        // keeps the text (the page treats the stripped URL query as its own).
        const name = findUnresolvedNames(value).find(n =>
          prefixFilterApplies(n.prefix, filters.docType),
        );
        if (name) {
          inputRef.current?.setSelectionRange(name.end, name.end);
          setCaret(name.end >= value.length ? null : name.end);
          return;
        }
        // As in the palette: Enter opens the highlighted result, and searches only when none is.
        // With a modifier (Shift included, as in the palette) it searches.
        const modified = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
        if (!modified && onOpenSelection?.()) return;
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
        setCaret(null);
        onLiveChange(demoted);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // First Escape discards the edit; the box keeps focus so it can be retyped.
        // Feed the committed query back to the live search too, otherwise the box would
        // show `query` while the results below stay on the discarded text.
        // Only an edit thrown away takes the result pick with it.
        if (value !== query) onResetSelection?.();
        setValue(query);
        setCaret(null);
        onLiveChange(query);
      }
    },
    [
      onLiveChange,
      onSubmit,
      onOpenSelection,
      onResetSelection,
      query,
      value,
      tokens,
      suggestions,
      highlighted,
      pick,
      holdsEmpty,
      filters.docType,
    ],
  );

  const handleClear = useCallback((): void => {
    setValue('');
    setCaret(null);
    onLiveChange('');
    onSubmit('');
    onResetSelection?.();
    inputRef.current?.focus();
  }, [onLiveChange, onSubmit, onResetSelection]);

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
      {/* No in-flight spinner here: the results list shows the loading skeleton, as in Cmd+K. */}
      <Search size={16} className='shrink-0 text-muted-foreground' />
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
        // Arrows, clicks and selection move the caret without changing the text.
        onSelect={event => trackCaret(event.currentTarget)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // The cold-start prompt only makes sense on an empty box; among applied tokens it
        // claims nothing is searched yet. The leading magnifier already says what this is,
        // so it shrinks rather than explains.
        placeholder={tokens.length > 0 ? 'Search' : 'Search messages, files, tickets…'}
        aria-label='Search query'
        role='combobox'
        aria-autocomplete='list'
        aria-expanded={listOpen}
        aria-controls={listOpen ? listboxId : undefined}
        aria-activedescendant={
          suggestions[highlighted]
            ? suggestionOptionId(listboxId, suggestions[highlighted])
            : undefined
        }
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
      {listOpen && (
        <QuerySuggestionList
          listboxId={listboxId}
          suggestions={suggestions}
          activeIndex={highlighted}
          emptyText={emptyText}
          onHover={setActiveIndex}
          onPick={pick}
        />
      )}
      {/* Mounted up front so a screen reader announces why Enter is held when nothing matches. */}
      <span role='status' className='sr-only'>
        {listOpen && (holdsEmpty || showsLoadFailure) ? emptyText : ''}
      </span>
    </label>
  );
}
