import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useScope, useShortcutById } from '../../shortcuts';
import { cn } from '../../utils/classNames';
import type { FindProvider } from './find';

/** Typing settles this long before a search runs: a page searched per keystroke stutters. */
const SEARCH_DELAY_MS = 120;

/**
 * The frame's find: ⌘F (Ctrl+F) or the toolbar's button opens it over the
 * preview's top right corner; Enter and ⇧Enter, or ⌘G and ⇧⌘G, step through the
 * matches; Escape puts it away and takes the marks down. It searches through
 * whatever the previewer on screen lends it, and goes quiet when that is nothing.
 */
export function useFindBar(finder: FindProvider | null): {
  open: () => void;
  bar: ReactElement | null;
} {
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState({ count: 0, index: 0, searched: false });
  const inputRef = useRef<HTMLInputElement | null>(null);

  const open = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);
  const close = useCallback(() => {
    finder?.clear();
    setOpen(false);
  }, [finder]);

  // A view with nothing to search takes the bar with it.
  useEffect(() => {
    if (!finder) setOpen(false);
  }, [finder]);

  // Searched afresh for a new query, and for a new view of the file — Source after
  // Preview, another sheet — which lends a new finder.
  useEffect(() => {
    if (!finder || !isOpen) return;
    if (!query) {
      finder.clear();
      setFound({ count: 0, index: 0, searched: false });
      return;
    }
    let stale = false;
    const timer = window.setTimeout(() => {
      void Promise.resolve(finder.search(query)).then(count => {
        if (stale) return;
        setFound({ count, index: 0, searched: true });
        if (count > 0) finder.reveal(0);
      });
    }, SEARCH_DELAY_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [finder, isOpen, query]);

  useEffect(() => () => finder?.clear(), [finder]);

  const step = useCallback(
    (by: number) => {
      if (!finder || found.count === 0) return;
      const index = (found.index + by + found.count) % found.count;
      finder.reveal(index);
      setFound(current => ({ ...current, index }));
    },
    [finder, found.count, found.index],
  );

  useScope('file-preview', finder !== null);
  useShortcutById('preview.find', open, { enabled: finder !== null });
  useShortcutById('preview.findNext', () => step(1), { enabled: isOpen && found.count > 0 });
  useShortcutById('preview.findPrevious', () => step(-1), { enabled: isOpen && found.count > 0 });

  if (!isOpen || !finder) return { open, bar: null };

  return {
    open,
    bar: (
      <div
        role='search'
        className='absolute right-3 top-2 z-30 flex h-9 items-center gap-1 rounded-lg border border-border bg-background pl-3 pr-1 shadow-lg'
      >
        <input
          ref={inputRef}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
          placeholder='Find'
          aria-label='Find in file'
          data-track-category='FilePreview'
          data-track-name='PreviewFindTyped'
          className='h-full w-52 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground'
        />
        <span
          aria-live='polite'
          className={cn(
            'min-w-[64px] shrink-0 text-right text-xs tabular-nums',
            found.searched && found.count === 0 ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {!found.searched
            ? ''
            : found.count === 0
              ? 'No results'
              : `${found.index + 1} of ${found.count.toLocaleString()}`}
        </span>
        <span aria-hidden='true' className='mx-1 h-4 w-px shrink-0 bg-border' />
        {(
          [
            {
              title: 'Previous match (⇧Enter)',
              icon: ChevronUp,
              by: -1,
              track: 'PreviewFindPrevious',
            },
            { title: 'Next match (Enter)', icon: ChevronDown, by: 1, track: 'PreviewFindNext' },
          ] as const
        ).map(action => (
          <button
            key={action.track}
            type='button'
            title={action.title}
            aria-label={action.title}
            disabled={found.count === 0}
            onClick={() => step(action.by)}
            className='outline-none flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:bg-foreground/[0.08] hover:text-foreground focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-40'
            data-track-category='FilePreview'
            data-track-name={action.track}
          >
            <action.icon className='size-4' />
          </button>
        ))}
        <button
          type='button'
          title='Close (Esc)'
          aria-label='Close find'
          onClick={close}
          className='outline-none flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:bg-foreground/[0.08] hover:text-foreground focus-visible:text-foreground'
          data-track-category='FilePreview'
          data-track-name='PreviewFindClosed'
        >
          <X className='size-4' />
        </button>
      </div>
    ),
  };
}
