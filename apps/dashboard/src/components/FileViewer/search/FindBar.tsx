import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { ShortcutTooltip } from '../../ui/ShortcutTooltip';
import { useFileSearchContext } from './FileSearchContext';
import { MAX_MATCHES } from './types';

const DEBOUNCE_MS = 150;

const toggleClass = (isOn: boolean): string =>
  cn(
    'inline-flex items-center justify-center h-6 w-6 rounded text-xs font-semibold transition-colors',
    isOn ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white hover:bg-white/10',
  );

const navClass = (disabled: boolean): string =>
  cn(
    'inline-flex items-center justify-center h-6 w-6 rounded transition-colors',
    disabled ? 'text-white/25 cursor-default' : 'text-white/70 hover:text-white hover:bg-white/10',
  );

/**
 * Find bar for the file viewer. Rendered by the modal; only visible once a
 * viewer has registered itself as searchable, so image/video previews never
 * show it.
 */
export const FindBar: React.FC = () => {
  const search = useFileSearchContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');

  const isVisible = Boolean(search?.isOpen && search.hasTarget);
  const focusSignal = search?.focusSignal ?? 0;
  const setQuery = search?.setQuery;
  const query = search?.query ?? '';

  // Focus (and select) whenever the bar opens or mod+f is pressed again.
  useEffect(() => {
    if (!isVisible) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isVisible, focusSignal]);

  // Keep the draft in step when the provider clears the query (close, or the
  // user navigating to another file).
  useEffect(() => {
    if (query === '') setDraft('');
  }, [query]);

  useEffect(() => {
    if (!setQuery) return;
    if (draft === query) return;
    const timer = setTimeout(() => setQuery(draft), DEBOUNCE_MS);
    return (): void => clearTimeout(timer);
  }, [draft, query, setQuery]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (!search) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) {
          search.prev();
        } else {
          search.next();
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // Stop Radix's Dialog from seeing this and closing the whole modal.
        event.stopPropagation();
        search.close();
      }
    },
    [search],
  );

  if (!search || !isVisible) return null;

  const { total, activeIndex, options, setOptions, next, prev, close } = search;
  const hasQuery = query.length > 0;
  const hasResults = total > 0;
  const countLabel = !hasQuery
    ? ''
    : hasResults
      ? `${activeIndex + 1}/${total}${total >= MAX_MATCHES ? '+' : ''}`
      : 'No results';

  return (
    <div className='absolute top-20 right-5 z-30 flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/95 px-2.5 py-1.5 shadow-xl backdrop-blur-md'>
      <Search className='h-3.5 w-3.5 shrink-0 text-white/50' />

      <input
        ref={inputRef}
        type='text'
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder='Find in file'
        aria-label='Find in file'
        spellCheck={false}
        autoComplete='off'
        className='w-44 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none'
        data-track-category='FileViewer'
        data-track-name='FindInput'
      />

      <span
        className={cn(
          'min-w-[4.5rem] shrink-0 text-right text-xs tabular-nums',
          hasQuery && !hasResults ? 'text-red-400' : 'text-white/50',
        )}
        aria-live='polite'
      >
        {countLabel}
      </span>

      <div className='mx-0.5 h-4 w-px shrink-0 bg-white/15' />

      <button
        type='button'
        onClick={() => setOptions({ caseSensitive: !options.caseSensitive })}
        className={toggleClass(options.caseSensitive)}
        title='Match case'
        aria-pressed={options.caseSensitive}
        data-track-category='FileViewer'
        data-track-name='FindToggleMatchCase'
      >
        Aa
      </button>

      <button
        type='button'
        onClick={() => setOptions({ wholeWord: !options.wholeWord })}
        className={toggleClass(options.wholeWord)}
        title='Match whole word'
        aria-pressed={options.wholeWord}
        data-track-category='FileViewer'
        data-track-name='FindToggleWholeWord'
      >
        {/* Word-boundary glyph, matching VS Code: "ab" over a bracket whose
            ends tick upward (bottom border + short left/right upticks), so it
            reads as "whole word captured" and is distinct from "Aa". */}
        <span className='inline-flex flex-col items-center leading-none'>
          ab
          <span className='mt-px h-[3px] w-full border-b border-l border-r border-current' />
        </span>
      </button>

      <div className='mx-0.5 h-4 w-px shrink-0 bg-white/15' />

      <ShortcutTooltip label='Previous match' shortcut='viewer.findPrevious' side='bottom'>
        <button
          type='button'
          onClick={prev}
          disabled={!hasResults}
          className={navClass(!hasResults)}
          aria-label='Previous match'
          data-track-category='FileViewer'
          data-track-name='FindPrevious'
        >
          <ChevronUp className='h-4 w-4' />
        </button>
      </ShortcutTooltip>

      <ShortcutTooltip label='Next match' shortcut='viewer.findNext' side='bottom'>
        <button
          type='button'
          onClick={next}
          disabled={!hasResults}
          className={navClass(!hasResults)}
          aria-label='Next match'
          data-track-category='FileViewer'
          data-track-name='FindNext'
        >
          <ChevronDown className='h-4 w-4' />
        </button>
      </ShortcutTooltip>

      <button
        type='button'
        onClick={close}
        className='inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/70 transition-colors hover:bg-white/10 hover:text-white'
        title='Close (Esc)'
        aria-label='Close find bar'
        data-track-category='FileViewer'
        data-track-name='FindClose'
      >
        <X className='h-4 w-4' />
      </button>
    </div>
  );
};
