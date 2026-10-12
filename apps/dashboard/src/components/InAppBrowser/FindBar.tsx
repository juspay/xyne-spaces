import type { ReactElement, Ref } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { ToolbarButton } from './ToolbarButton';

/** Find in the page, as it runs: which match is shown, of how many. */
export interface FindResult {
  active: number;
  matches: number;
}

/**
 * Finding in the page, beside its address: what to look for, where it is among the
 * matches, and the way to the next and the last one. Enter steps on, ⇧Enter back,
 * Esc closes.
 */
export function FindBar(props: {
  text: string;
  result: FindResult | null;
  onChange: (text: string) => void;
  onStep: (forward: boolean) => void;
  onClose: () => void;
  inputRef: Ref<HTMLInputElement>;
  trackCategory: string;
}): ReactElement {
  const { result } = props;
  return (
    <div
      role='search'
      className='mr-1 flex h-8 w-[300px] max-w-[45%] shrink-0 items-center gap-1 rounded-lg border border-border bg-background pl-2.5 pr-1 shadow-sm'
    >
      <Search className='size-3.5 shrink-0 text-muted-foreground' />
      <input
        ref={props.inputRef}
        value={props.text}
        onChange={event => props.onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            props.onStep(!event.shiftKey);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            props.onClose();
          }
        }}
        placeholder='Find in page'
        aria-label='Find in page'
        spellCheck={false}
        className='h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground'
        data-track-category={props.trackCategory}
        data-track-name='EmbeddedPageFindTyped'
      />
      <span
        aria-live='polite'
        className={cn(
          'shrink-0 px-1 text-[11.5px] tabular-nums',
          props.text && result?.matches === 0 ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {!props.text || !result
          ? ''
          : result.matches === 0
            ? 'No results'
            : `${result.active} of ${result.matches}`}
      </span>
      <ToolbarButton
        label='Previous match (⇧↵)'
        onClick={() => props.onStep(false)}
        disabled={!result?.matches}
        trackCategory={props.trackCategory}
        trackName='EmbeddedPageFindPrevious'
      >
        <ChevronUp className='size-3.5' />
      </ToolbarButton>
      <ToolbarButton
        label='Next match (↵)'
        onClick={() => props.onStep(true)}
        disabled={!result?.matches}
        trackCategory={props.trackCategory}
        trackName='EmbeddedPageFindNext'
      >
        <ChevronDown className='size-3.5' />
      </ToolbarButton>
      <ToolbarButton
        label='Close find (Esc)'
        onClick={props.onClose}
        trackCategory={props.trackCategory}
        trackName='EmbeddedPageFindClosed'
      >
        <X className='size-3.5' />
      </ToolbarButton>
    </div>
  );
}
