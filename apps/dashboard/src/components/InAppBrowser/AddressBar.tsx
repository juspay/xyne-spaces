import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AppWindow, Globe, History, Search } from 'lucide-react';
import { addressFor, hostOf } from '../../utils/browserAddress';
import { cn } from '../../utils/classNames';
import type { HistorySource } from './history';

/** An open tab the bar can switch to when what is typed matches it. */
export interface OpenTabSuggestion {
  key: string;
  url: string;
  title: string;
  favicon: string;
}

type Suggestion =
  | { kind: 'go'; url: string }
  | { kind: 'search'; query: string; past: boolean }
  | { kind: 'page'; url: string; title: string; favicon: string }
  | { kind: 'tab'; key: string; url: string; title: string; favicon: string };

const searchUrl = (query: string): string =>
  `https://www.google.com/search?q=${encodeURIComponent(query)}`;

/** An address as a reader reads it: without its scheme, a www or a trailing slash. */
const readable = (url: string): string =>
  url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

/** What going with the typed text itself does: an address, or a search. */
function typedSuggestion(text: string): Suggestion | null {
  const target = addressFor(text);
  if (!target) return null;
  return target.startsWith('https://www.google.com/search?')
    ? { kind: 'search', query: text.trim(), past: false }
    : { kind: 'go', url: target };
}

function SuggestionIcon(props: { suggestion: Suggestion }): ReactElement {
  const { suggestion } = props;
  const [broken, setBroken] = useState(false);
  if (suggestion.kind === 'search') {
    return suggestion.past ? <History className='size-4' /> : <Search className='size-4' />;
  }
  if ((suggestion.kind === 'page' || suggestion.kind === 'tab') && suggestion.favicon && !broken) {
    return (
      <img
        src={suggestion.favicon}
        alt=''
        className='size-4 rounded-[3px] object-contain'
        onError={() => setBroken(true)}
      />
    );
  }
  return <Globe className='size-4' />;
}

function SuggestionText(props: { suggestion: Suggestion }): ReactElement {
  const { suggestion } = props;
  const quiet = 'shrink-0 text-muted-foreground';
  if (suggestion.kind === 'go') {
    return <span className='min-w-0 flex-1 truncate'>{readable(suggestion.url)}</span>;
  }
  if (suggestion.kind === 'search') {
    return (
      <>
        <span className='min-w-0 truncate'>{suggestion.query}</span>
        {!suggestion.past && <span className={quiet}>— Search Google</span>}
      </>
    );
  }
  const name = suggestion.title || hostOf(suggestion.url) || suggestion.url;
  return (
    <>
      <span className='min-w-0 truncate'>{name}</span>
      <span className='min-w-0 flex-1 truncate text-muted-foreground'>
        — {readable(suggestion.url)}
      </span>
      {suggestion.kind === 'tab' && (
        <span className='flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground'>
          <AppWindow className='size-3' />
          Switch to tab
        </span>
      )}
    </>
  );
}

/**
 * Where a browser goes: the page's address while it is just shown, and — once typed
 * in — a list beneath of where that could go, as a browser's own bar offers. First
 * the typed text itself, as an address or a search; then open tabs that match, the
 * searches made before, and the pages visited, most often and lately first.
 *
 * ↑ and ↓ move through the list, Enter goes, Esc puts the address back and, again,
 * leaves the bar. The list is drawn over everything, marked as an overlay, so a page
 * drawn above a frame steps aside for it.
 */
export function AddressBar(props: {
  /** The page's address, shown while the bar isn't being typed in; empty for none. */
  value: string;
  onGo: (url: string) => void;
  history?: HistorySource;
  openTabs?: readonly OpenTabSuggestion[];
  onSwitchTab?: (key: string) => void;
  /** Connects ahead to the suggestion Enter would open. */
  preconnect?: (url: string) => void;
  inputRef?: MutableRefObject<HTMLInputElement | null>;
  /** Inside the field, before the text: the lock, a saved link's pill. */
  leading?: ReactNode;
  /** Inside the field, after the text: the page's zoom, say. */
  trailing?: ReactNode;
  /** `bar` sits in a toolbar; `hero` is a new tab's one big box. */
  variant: 'bar' | 'hero';
  placeholder: string;
  autoFocus?: boolean;
  trackCategory: string;
  trackName: string;
}): ReactElement {
  const ownRef = useRef<HTMLInputElement | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  // Null while the bar isn't being typed in; the address shows then.
  const [draft, setDraft] = useState<string | null>(null);
  // Where the reader just sent it: shown at once, as a browser's bar does, until the
  // page lands there and says its own address.
  const [heading, setHeading] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => setHeading(null), [props.value]);

  const bindInput = (element: HTMLInputElement | null): void => {
    ownRef.current = element;
    if (props.inputRef) props.inputRef.current = element;
  };

  // The list follows what is typed: the typed text and matching tabs at once, the
  // history a beat later, once typing settles. An answer for older text is dropped.
  const text = typed ? (draft ?? '') : '';
  const historyRef = useRef(props.history);
  historyRef.current = props.history;
  const tabsRef = useRef(props.openTabs);
  tabsRef.current = props.openTabs;
  useEffect(() => {
    const query = text.trim();
    if (!query) {
      setSuggestions([]);
      return undefined;
    }
    const first = typedSuggestion(query);
    const lower = query.toLowerCase();
    const tabs: Suggestion[] = (tabsRef.current ?? [])
      .filter(
        tab =>
          tab.url &&
          (tab.title.toLowerCase().includes(lower) ||
            readable(tab.url).toLowerCase().includes(lower)),
      )
      .slice(0, 2)
      .map(tab => ({ kind: 'tab', ...tab }));
    const now: Suggestion[] = [...(first ? [first] : []), ...tabs];
    setSuggestions(now);
    setHighlight(0);
    const source = historyRef.current;
    if (!source) return undefined;
    let current = true;
    const timer = window.setTimeout(() => {
      void source.suggest(query, 6).then(found => {
        if (!current) return;
        const seen = new Set(
          now.flatMap(entry => (entry.kind === 'go' || entry.kind === 'tab' ? [entry.url] : [])),
        );
        const searches: Suggestion[] = found.searches
          .filter(search => search.toLowerCase() !== lower)
          .slice(0, 3)
          .map(search => ({ kind: 'search', query: search, past: true }));
        const pages: Suggestion[] = found.pages
          .filter(page => !seen.has(page.url))
          .slice(0, 5)
          .map(page => ({ kind: 'page', ...page }));
        setSuggestions([...now, ...searches, ...pages]);
      });
    }, 90);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [text]);

  const open = typed && suggestions.length > 0;

  // Where Enter would go, connected to ahead — once a site, as the list settles.
  const preconnectRef = useRef(props.preconnect);
  preconnectRef.current = props.preconnect;
  const connected = useRef(new Set<string>());
  const chosen = open ? suggestions[highlight] : undefined;
  const ahead = !chosen ? null : chosen.kind === 'search' ? searchUrl(chosen.query) : chosen.url;
  useEffect(() => {
    if (!ahead || !preconnectRef.current) return undefined;
    let origin = '';
    try {
      origin = new URL(ahead).origin;
    } catch {
      return undefined;
    }
    if (connected.current.has(origin)) return undefined;
    const timer = window.setTimeout(() => {
      connected.current.add(origin);
      preconnectRef.current?.(origin);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [ahead]);

  // Under the field, as wide as it; kept there as the window resizes.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = (): void => {
      const box = fieldRef.current?.getBoundingClientRect();
      if (box) setPlace({ left: box.left, top: box.bottom + 4, width: Math.max(box.width, 320) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  const reset = (): void => {
    setDraft(null);
    setTyped(false);
    setSuggestions([]);
  };

  const choose = (suggestion: Suggestion): void => {
    reset();
    if (props.variant === 'bar') ownRef.current?.blur();
    if (suggestion.kind === 'tab') {
      props.onSwitchTab?.(suggestion.key);
      return;
    }
    const url = suggestion.kind === 'search' ? searchUrl(suggestion.query) : suggestion.url;
    setHeading(url);
    props.onGo(url);
  };

  const shown = draft ?? heading ?? props.value;

  return (
    <div
      ref={fieldRef}
      className={cn(
        'flex min-w-0 items-center transition-[background-color,box-shadow,border-color]',
        props.variant === 'bar'
          ? 'mx-1.5 h-8 flex-1 gap-1.5 rounded-lg bg-foreground/[0.06] pl-1 pr-2 focus-within:bg-background focus-within:ring-1 focus-within:ring-border'
          : 'h-12 w-full gap-3 rounded-2xl border border-border bg-background px-4 shadow-sm focus-within:border-foreground/20 focus-within:shadow-md',
      )}
    >
      {props.variant === 'hero' ? (
        <Search className='size-[18px] shrink-0 text-muted-foreground' />
      ) : (
        props.leading
      )}
      <input
        ref={bindInput}
        value={shown}
        // Taking what was typed: the page's own address goes back once it's left.
        onChange={event => {
          setDraft(event.target.value);
          setTyped(true);
        }}
        onFocus={event => {
          setDraft(props.value);
          event.target.select();
        }}
        onBlur={reset}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!open) return;
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setHighlight(index => (index + step + suggestions.length) % suggestions.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const chosen = open ? suggestions[highlight] : typedSuggestion(shown);
            if (chosen) choose(chosen);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            if (open || (typed && draft !== props.value)) {
              // First the address comes back, then the bar is left.
              setDraft(props.value);
              setTyped(false);
              setSuggestions([]);
              requestAnimationFrame(() => ownRef.current?.select());
            } else {
              reset();
              ownRef.current?.blur();
            }
          }
        }}
        autoFocus={props.autoFocus}
        spellCheck={false}
        autoComplete='off'
        placeholder={props.placeholder}
        aria-label={props.variant === 'hero' ? 'Search or type a URL' : 'Address'}
        role='combobox'
        aria-autocomplete='list'
        aria-expanded={open}
        aria-controls={listId}
        {...(open && { 'aria-activedescendant': `${listId}-${highlight}` })}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground',
          props.variant === 'bar' ? 'text-[12.5px]' : 'text-[15px]',
        )}
        data-track-category={props.trackCategory}
        data-track-name={props.trackName}
      />
      {props.variant === 'bar' && props.trailing}
      {props.variant === 'hero' && (
        <kbd className='hidden shrink-0 rounded border border-border bg-muted px-1.5 py-px font-sans text-[11px] text-muted-foreground sm:block'>
          ↵
        </kbd>
      )}
      {open &&
        place &&
        createPortal(
          <div
            id={listId}
            role='listbox'
            aria-label='Suggestions'
            // The keyboard stays in the bar, which moves through these for it.
            tabIndex={-1}
            data-xyne-overlay=''
            // Keeps the keyboard in the bar: a click here chooses, it doesn't blur.
            onMouseDown={event => event.preventDefault()}
            className='fixed z-[70] overflow-hidden rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl'
            style={{ left: place.left, top: place.top, width: place.width }}
          >
            {suggestions.map((suggestion, index) => (
              <div
                key={`${suggestion.kind}-${index}`}
                id={`${listId}-${index}`}
                role='option'
                aria-selected={index === highlight}
                tabIndex={-1}
                onKeyDown={event => {
                  if (event.key === 'Enter') choose(suggestion);
                }}
                onMouseMove={() => setHighlight(index)}
                onClick={() => choose(suggestion)}
                className={cn(
                  'flex h-9 cursor-pointer items-center gap-2.5 px-3 text-[13px]',
                  index === highlight && 'bg-accent',
                )}
                data-track-category={props.trackCategory}
                data-track-name='AddressSuggestionChosen'
                data-track-metadata={JSON.stringify({ kind: suggestion.kind })}
              >
                <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
                  <SuggestionIcon suggestion={suggestion} />
                </span>
                <SuggestionText suggestion={suggestion} />
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
